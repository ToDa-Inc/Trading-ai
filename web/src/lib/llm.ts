// Capa de LLM sobre OpenRouter (compatible con OpenAI).
// - Chat: /chat/completions (streaming, soporta imágenes/capturas)
// - Embeddings: /embeddings
// El análisis de video NO pasa por aquí: lo hace el worker con Google Gemini directo.

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const API_KEY = process.env.OPENROUTER_API_KEY!;
const CHAT_MODEL = process.env.OPENROUTER_CHAT_MODEL || "google/gemini-2.5-flash";
const EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL || "openai/text-embedding-3-small";

const REFERER = process.env.OPENROUTER_SITE_URL || "http://localhost:3000";
const TITLE = "Trading Coach";

function headers() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": REFERER,
    "X-Title": TITLE,
  };
}

export async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenRouter embeddings error (${res.status}): ${detail}`);
  }

  const json = await res.json();
  return json.data[0].embedding as number[];
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

function buildPrompt(userMessage: string, context: ChatContext): string {
  const chunksText = context.chunks
    .map(
      (c, i) =>
        `[Fragmento ${i + 1}] (video: ${c.metadata?.filename || c.video_id}, ${
          c.ts_start != null ? `t=${c.ts_start}s` : ""
        }, relevancia: ${(c.similarity * 100).toFixed(0)}%)\n${c.content}`
    )
    .join("\n\n");

  return `## Perfil de estrategia del usuario
${context.strategyProfile || "Aún no hay perfil de estrategia. El usuario no ha subido videos procesados."}

## Fragmentos relevantes de los videos
${chunksText || "No hay fragmentos relevantes."}

## Pregunta del usuario
${userMessage}`;
}

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };

function buildUserContent(
  userMessage: string,
  context: ChatContext
): string | Array<TextPart | ImagePart> {
  const prompt = buildPrompt(userMessage, context);

  if (context.imageBase64 && context.imageMimeType) {
    return [
      { type: "text", text: prompt },
      {
        type: "image_url",
        image_url: {
          url: `data:${context.imageMimeType};base64,${context.imageBase64}`,
        },
      },
      {
        type: "text",
        text: "\n[El usuario ha adjuntado una captura de una operación o del mercado. Evalúala según su estrategia.]",
      },
    ];
  }

  return prompt;
}

export async function* streamChatResponse(
  userMessage: string,
  context: ChatContext
): AsyncGenerator<string> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: CHAT_MODEL,
      stream: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserContent(userMessage, context) },
      ],
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenRouter chat error (${res.status}): ${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // línea de keep-alive o fragmento incompleto: ignorar
      }
    }
  }
}
