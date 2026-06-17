const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

// Multimodal: chat + screenshot analysis
const CHAT_MODEL =
  process.env.OPENROUTER_CHAT_MODEL || "google/gemini-3.1-flash-lite";

// RAG retrieval: separate embedding model (must match worker)
const EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL || "openai/text-embedding-3-small";
const EMBEDDING_DIMENSIONS = Number(
  process.env.OPENROUTER_EMBEDDING_DIMENSIONS || "768"
);

export async function embedQuery(text: string): Promise<number[]> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      input_type: "search_query",
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter embeddings error ${response.status}: ${errorBody}`);
  }

  const result = (await response.json()) as {
    data?: Array<{ embedding: number[] }>;
  };
  const embedding = result.data?.[0]?.embedding;
  if (!embedding) {
    throw new Error("OpenRouter returned no embedding");
  }
  return embedding;
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

type OpenRouterContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function buildPrompt(userMessage: string, context: ChatContext, detailed = true) {
  const chunksText = context.chunks
    .map((c, i) => {
      const relevance = detailed
        ? `, relevancia: ${(c.similarity * 100).toFixed(0)}%`
        : "";
      return `[Fragmento ${i + 1}] (video: ${c.metadata?.filename || c.video_id}, ${c.ts_start != null ? `t=${c.ts_start}s` : ""}${relevance})\n${c.content}`;
    })
    .join("\n\n");

  const profileFallback = detailed
    ? "Aún no hay perfil de estrategia. El usuario no ha subido videos procesados."
    : "Aún no hay perfil de estrategia.";

  const chunksFallback = detailed ? "No hay fragmentos relevantes." : "No hay fragmentos.";

  return `## Perfil de estrategia del usuario
${context.strategyProfile || profileFallback}

## Fragmentos relevantes${detailed ? " de los videos" : ""}
${chunksText || chunksFallback}

## Pregunta${detailed ? " del usuario" : ""}
${userMessage}`;
}

function buildUserContent(
  userMessage: string,
  context: ChatContext,
  detailed = true
): OpenRouterContentPart[] {
  const content: OpenRouterContentPart[] = [
    { type: "text", text: buildPrompt(userMessage, context, detailed) },
  ];

  if (context.imageBase64 && context.imageMimeType) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${context.imageMimeType};base64,${context.imageBase64}`,
      },
    });
    if (detailed) {
      content.push({
        type: "text",
        text: "\n[El usuario ha adjuntado una captura de pantalla de una operación o del mercado. Evalúala según su estrategia.]",
      });
    }
  }

  return content;
}

function openRouterHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_APP_NAME || "Trading Coach",
  };
}

async function* parseOpenRouterStream(
  response: Response
): AsyncGenerator<string> {
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${errorBody}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("OpenRouter stream unavailable");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd === -1) break;

      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);

      if (!line.startsWith("data: ")) continue;

      const data = line.slice(6);
      if (data === "[DONE]") return;

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
          error?: { message?: string };
        };

        if (parsed.error?.message) {
          throw new Error(parsed.error.message);
        }

        const token = parsed.choices?.[0]?.delta?.content;
        if (token) yield token;
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }
}

export async function generateChatResponse(
  userMessage: string,
  context: ChatContext
): Promise<{ text: string; citations: Array<{ video_id: string; ts_start?: number; topic?: string }> }> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserContent(userMessage, context) },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${errorBody}`);
  }

  const result = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = result.choices?.[0]?.message?.content ?? "";

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
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserContent(userMessage, context, false) },
      ],
      stream: true,
    }),
  });

  yield* parseOpenRouterStream(response);
}
