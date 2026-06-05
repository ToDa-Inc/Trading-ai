import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "text-embedding-004";

export async function embedQuery(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const result = await model.embedContent({
    content: { role: "user", parts: [{ text }] },
    taskType: TaskType.RETRIEVAL_QUERY,
  });
  return result.embedding.values;
}

export interface ChatContext {
  strategyProfile: string;
  chunks: Array<{
    content: string;
    metadata: Record<string, unknown>;
    ts_start?: number | null;
    ts_end?: number | null;
    similarity: number;
    video_id: string;
  }>;
  imageBase64?: string;
  imageMimeType?: string;
}

const SYSTEM_PROMPT = `Eres un asistente experto en trading que ayuda al usuario a evaluar operaciones según SU estrategia personal.

REGLAS ESTRICTAS:
1. Responde ÚNICAMENTE basándote en el perfil de estrategia y los fragmentos de video proporcionados.
2. Si la información no está en el contexto, di claramente "No tengo información sobre esto en tus videos".
3. Nunca inventes reglas ni recomendaciones que el usuario no haya explicado.
4. Cuando evalúes una operación (texto o captura), indica:
   - Nivel de recomendación: Alta / Media / Baja / No recomendada
   - Reglas que cumple y las que viola
   - Citas a videos con timestamps cuando sea posible
5. Responde en español, de forma clara y directa.`;

export async function generateChatResponse(
  userMessage: string,
  context: ChatContext
): Promise<{ text: string; citations: Array<{ video_id: string; ts_start?: number; topic?: string }> }> {
  const model = genAI.getGenerativeModel({
    model: CHAT_MODEL,
    systemInstruction: SYSTEM_PROMPT,
  });

  const chunksText = context.chunks
    .map(
      (c, i) =>
        `[Fragmento ${i + 1}] (video: ${c.metadata?.filename || c.video_id}, ${c.ts_start != null ? `t=${c.ts_start}s` : ""}, relevancia: ${(c.similarity * 100).toFixed(0)}%)\n${c.content}`
    )
    .join("\n\n");

  const prompt = `## Perfil de estrategia del usuario
${context.strategyProfile || "Aún no hay perfil de estrategia. El usuario no ha subido videos procesados."}

## Fragmentos relevantes de los videos
${chunksText || "No hay fragmentos relevantes."}

## Pregunta del usuario
${userMessage}`;

  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
    { text: prompt },
  ];

  if (context.imageBase64 && context.imageMimeType) {
    parts.push({
      inlineData: {
        data: context.imageBase64,
        mimeType: context.imageMimeType,
      },
    });
    parts.push({
      text: "\n[El usuario ha adjuntado una captura de pantalla de una operación o del mercado. Evalúala según su estrategia.]",
    });
  }

  const result = await model.generateContent(parts);
  const text = result.response.text();

  const citations = context.chunks
    .filter((c) => c.similarity > 0.5)
    .slice(0, 5)
    .map((c) => ({
      video_id: c.video_id,
      ts_start: c.ts_start ?? undefined,
      topic: (c.metadata?.topic as string) || undefined,
    }));

  return { text, citations };
}

export async function* streamChatResponse(
  userMessage: string,
  context: ChatContext
): AsyncGenerator<string> {
  const model = genAI.getGenerativeModel({
    model: CHAT_MODEL,
    systemInstruction: SYSTEM_PROMPT,
  });

  const chunksText = context.chunks
    .map(
      (c, i) =>
        `[Fragmento ${i + 1}] (video: ${c.metadata?.filename || c.video_id}, ${c.ts_start != null ? `t=${c.ts_start}s` : ""})\n${c.content}`
    )
    .join("\n\n");

  const prompt = `## Perfil de estrategia del usuario
${context.strategyProfile || "Aún no hay perfil de estrategia."}

## Fragmentos relevantes
${chunksText || "No hay fragmentos."}

## Pregunta
${userMessage}`;

  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
    { text: prompt },
  ];

  if (context.imageBase64 && context.imageMimeType) {
    parts.push({
      inlineData: { data: context.imageBase64, mimeType: context.imageMimeType },
    });
  }

  const result = await model.generateContentStream(parts);

  for await (const chunk of result.stream) {
    const t = chunk.text();
    if (t) yield t;
  }
}
