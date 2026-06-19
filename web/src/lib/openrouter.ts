const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

const CHAT_MODEL =
  process.env.OPENROUTER_CHAT_MODEL || "google/gemini-3.1-flash-lite";

const EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL || "openai/text-embedding-3-small";
const EMBEDDING_DIMENSIONS = Number(
  process.env.OPENROUTER_EMBEDDING_DIMENSIONS || "768"
);

export interface ChunkMatch {
  id: string;
  video_id: string;
  content: string;
  metadata: Record<string, unknown>;
  ts_start: number | null;
  ts_end: number | null;
  similarity: number;
}

type OpenRouterContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessageParam =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OpenRouterContentPart[] }
  | { role: "assistant"; content: string };

function openRouterHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_APP_NAME || "Trading Coach",
  };
}

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

function extractJsonBlob(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    const withoutFence = cleaned.split("\n").slice(1).join("\n");
    cleaned = withoutFence.split("```")[0] ?? withoutFence;
    if (cleaned.toLowerCase().startsWith("json")) {
      cleaned = cleaned.slice(4).trimStart();
    }
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  return cleaned;
}

export async function chatCompletionJson<T>(options: {
  messages: ChatMessageParam[];
  schemaName: string;
  schema: Record<string, unknown>;
  temperature?: number;
}): Promise<T> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: options.messages,
      temperature: options.temperature ?? 0.1,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: options.schemaName,
          strict: false,
          schema: options.schema,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${errorBody}`);
  }

  const result = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = result.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenRouter returned empty JSON response");
  }

  return JSON.parse(extractJsonBlob(text)) as T;
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

export async function* streamChatCompletion(
  messages: ChatMessageParam[],
  options?: { temperature?: number }
): AsyncGenerator<string> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages,
      stream: true,
      temperature: options?.temperature ?? 0.15,
    }),
  });

  yield* parseOpenRouterStream(response);
}
