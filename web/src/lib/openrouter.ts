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

const SYSTEM_PROMPT = `Eres un asistente experto en trading que ayuda al usuario según SU estrategia personal.

REGLAS ESTRICTAS:
1. Responde ÚNICAMENTE con el conocimiento del perfil de estrategia y los fragmentos proporcionados.
2. Si la información no está en el contexto, di claramente "No tengo esa información en tu estrategia".
3. Nunca inventes reglas ni recomendaciones que el usuario no haya definido.
4. Presenta el conocimiento como reglas y criterios del propio usuario ("tu estrategia indica...", "según tus criterios...").
5. NUNCA menciones videos, timestamps, minutos, segundos, fragmentos, fuentes ni referencias a dónde se explicó algo.
6. Cuando evalúes una operación (texto o captura), estructura la respuesta así:
   - **Recomendación:** Alta / Media / Baja / No recomendada
   - **Criterios que cumple:** lista breve
   - **Criterios que viola:** lista breve
   - **Observaciones:** matices relevantes
7. Usa markdown ligero: **negritas** para etiquetas, listas con guiones, párrafos separados.
8. Responde en español, claro y directo.`;

type OpenRouterContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function buildPrompt(userMessage: string, context: ChatContext) {
  const knowledgeText = context.chunks
    .map((c, i) => {
      const topic = (c.metadata?.topic as string) || `Área ${i + 1}`;
      return `### ${topic}\n${c.content}`;
    })
    .join("\n\n");

  return `## Perfil de estrategia del usuario
${context.strategyProfile || "Aún no hay perfil de estrategia definido."}

## Conocimiento relevante de la estrategia
${knowledgeText || "No hay conocimiento adicional relevante para esta consulta."}

## Consulta del usuario
${userMessage}`;
}

function buildUserContent(
  userMessage: string,
  context: ChatContext
): OpenRouterContentPart[] {
  const content: OpenRouterContentPart[] = [
    { type: "text", text: buildPrompt(userMessage, context) },
  ];

  if (context.imageBase64 && context.imageMimeType) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${context.imageMimeType};base64,${context.imageBase64}`,
      },
    });
    content.push({
      type: "text",
      text: "\n[El usuario ha adjuntado una captura de pantalla de una operación o del mercado. Evalúala según su estrategia.]",
    });
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

  return { text, citations: [] };
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
        { role: "user", content: buildUserContent(userMessage, context) },
      ],
      stream: true,
    }),
  });

  yield* parseOpenRouterStream(response);
}
