import { NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { embedQuery, streamChatResponse } from "@/lib/gemini";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "No autenticado" }), { status: 401 });
  }

  const formData = await request.formData();
  const message = formData.get("message") as string;
  let sessionId = formData.get("sessionId") as string | null;
  const imageFile = formData.get("image") as File | null;

  if (!message?.trim() && !imageFile) {
    return new Response(JSON.stringify({ error: "Mensaje vacío" }), { status: 400 });
  }

  const serviceClient = await createServiceClient();

  // Create session if needed
  if (!sessionId) {
    const { data: session, error } = await serviceClient
      .from("chat_sessions")
      .insert({
        user_id: user.id,
        title: message.slice(0, 50) || "Captura de operación",
      })
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    sessionId = session.id;
  }

  // Upload image if provided
  let imageBase64: string | undefined;
  let imageMimeType: string | undefined;
  let imagePath: string | null = null;

  if (imageFile && imageFile.size > 0) {
    const ext = imageFile.name.split(".").pop() || "png";
    imagePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const buffer = Buffer.from(await imageFile.arrayBuffer());

    await serviceClient.storage
      .from("chat-uploads")
      .upload(imagePath, buffer, { contentType: imageFile.type });

    imageBase64 = buffer.toString("base64");
    imageMimeType = imageFile.type;
  }

  // Save user message
  await serviceClient.from("chat_messages").insert({
    session_id: sessionId,
    user_id: user.id,
    role: "user",
    content: message,
    image_path: imagePath,
  });

  // RAG retrieval
  const queryText = message || "evaluación de operación captura de pantalla trading";
  const queryEmbedding = await embedQuery(queryText);

  const { data: chunks } = await serviceClient.rpc("match_chunks", {
    query_embedding: queryEmbedding,
    match_count: 25,
    filter_user_id: user.id,
  });

  const { data: profile } = await serviceClient
    .from("strategy_profiles")
    .select("summary_md")
    .eq("user_id", user.id)
    .maybeSingle();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send({ type: "session", sessionId });

      let fullText = "";
      try {
        const context = {
          strategyProfile: profile?.summary_md || "",
          chunks: (chunks || []).map((c: {
            video_id: string;
            content: string;
            metadata: Record<string, unknown>;
            ts_start: number | null;
            ts_end: number | null;
            similarity: number;
          }) => ({
            video_id: c.video_id,
            content: c.content,
            metadata: c.metadata,
            ts_start: c.ts_start,
            ts_end: c.ts_end,
            similarity: c.similarity,
          })),
          imageBase64,
          imageMimeType,
        };

        for await (const token of streamChatResponse(message, context)) {
          fullText += token;
          send({ type: "token", text: token });
        }

        type ChunkCtx = (typeof context.chunks)[number];
        const citations = context.chunks
          .filter((c: ChunkCtx) => c.similarity > 0.5)
          .slice(0, 5)
          .map((c: ChunkCtx) => ({
            video_id: c.video_id,
            ts_start: c.ts_start ?? undefined,
            topic: (c.metadata?.topic as string) || undefined,
          }));

        await serviceClient.from("chat_messages").insert({
          session_id: sessionId,
          user_id: user.id,
          role: "assistant",
          content: fullText,
          citations,
        });

        send({ type: "done", citations });
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : "Error desconocido" });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
