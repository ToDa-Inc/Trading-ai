import { NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runChatAgent } from "@/lib/chat-agent";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "No autenticado" }), { status: 401 });
  }

  const formData = await request.formData();
  const message = (formData.get("message") as string) || "";
  let sessionId = formData.get("sessionId") as string | null;
  const imageFile = formData.get("image") as File | null;

  if (!message.trim() && !imageFile) {
    return new Response(JSON.stringify({ error: "Mensaje vacío" }), { status: 400 });
  }

  const serviceClient = await createServiceClient();
  const userContent = message.trim() || "Evalúa esta operación según mi estrategia.";

  if (!sessionId) {
    const { data: session, error } = await serviceClient
      .from("chat_sessions")
      .insert({
        user_id: user.id,
        title: userContent.slice(0, 50) || "Captura de operación",
      })
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
    sessionId = session.id;
  }

  if (!sessionId) {
    return new Response(JSON.stringify({ error: "No se pudo crear la sesión" }), { status: 500 });
  }

  const activeSessionId: string = sessionId;

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

  await serviceClient.from("chat_messages").insert({
    session_id: activeSessionId,
    user_id: user.id,
    role: "user",
    content: userContent,
    image_path: imagePath,
  });

  await serviceClient
    .from("chat_sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", activeSessionId);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      send({ type: "session", sessionId: activeSessionId });

      let fullText = "";
      let citations: Array<{ video_id: string; ts_start?: number; topic?: string }> = [];

      try {
        for await (const event of runChatAgent({
          serviceClient,
          userId: user.id,
          sessionId: activeSessionId,
          message: userContent,
          imageBase64,
          imageMimeType,
        })) {
          if (event.type === "status") {
            send({ type: "status", text: event.text });
          } else if (event.type === "intent") {
            send({ type: "intent", intent: event.intent });
          } else if (event.type === "token") {
            fullText += event.text;
            send({ type: "token", text: event.text });
          } else if (event.type === "metadata") {
            citations = event.citations;
            send({ type: "metadata", intent: event.intent, citations: event.citations });
          } else if (event.type === "done") {
            await serviceClient.from("chat_messages").insert({
              session_id: activeSessionId,
              user_id: user.id,
              role: "assistant",
              content: fullText,
              citations,
            });

            await serviceClient
              .from("chat_sessions")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", activeSessionId);

            send({ type: "done" });
          } else if (event.type === "error") {
            send({ type: "error", error: event.error });
          }
        }
      } catch (err) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : "Error desconocido",
        });
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
