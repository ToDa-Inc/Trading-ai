const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const VIDEO_MODEL =
  process.env.OPENROUTER_VIDEO_MODEL || "google/gemini-3.1-flash-lite";
const CHAT_MODEL =
  process.env.OPENROUTER_CHAT_MODEL || "google/gemini-3.1-flash-lite";
const EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL || "openai/text-embedding-3-small";
const EMBEDDING_DIMENSIONS = Number(
  process.env.OPENROUTER_EMBEDDING_DIMENSIONS || "768"
);

const ANALYSIS_PROMPT = `Analiza este video de trading en detalle. El usuario explica su técnica y estrategia de trading.

Devuelve un JSON con esta estructura exacta:
{
  "transcript": "transcripción completa del audio, sin timestamps ni referencias al video",
  "strategy": {
    "name": "nombre de la estrategia si se menciona",
    "description": "descripción general",
    "entry_rules": ["regla de entrada 1", "regla 2"],
    "exit_rules": ["regla de salida 1", "regla 2"],
    "risk_management": ["gestión de riesgo 1", "regla 2"],
    "indicators": ["indicador 1", "indicador 2"],
    "timeframes": ["timeframe 1"],
    "patterns": ["patrón 1", "patrón 2"],
    "do_not_trade": ["condiciones donde NO operar"]
  },
  "segments": [
    {
      "topic": "tema del segmento",
      "ts_start": 0,
      "ts_end": 120,
      "content": "resumen detallado de las reglas y conceptos explicados, redactado como conocimiento de estrategia (sin mencionar el video ni timestamps)",
      "rules": ["reglas específicas mencionadas"]
    }
  ]
}

Sé exhaustivo. Captura TODAS las reglas, condiciones, indicadores y matices que el trader mencione.
Responde SOLO con el JSON válido, sin markdown ni texto adicional.`;

const VIDEO_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    transcript: { type: "string" },
    strategy: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        entry_rules: { type: "array", items: { type: "string" } },
        exit_rules: { type: "array", items: { type: "string" } },
        risk_management: { type: "array", items: { type: "string" } },
        indicators: { type: "array", items: { type: "string" } },
        timeframes: { type: "array", items: { type: "string" } },
        patterns: { type: "array", items: { type: "string" } },
        do_not_trade: { type: "array", items: { type: "string" } },
      },
    },
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          ts_start: { type: "number" },
          ts_end: { type: ["number", "null"] },
          content: { type: "string" },
          rules: { type: "array", items: { type: "string" } },
        },
        required: ["topic", "content"],
      },
    },
  },
  required: ["transcript", "strategy", "segments"],
};

export interface VideoAnalysis {
  transcript: string;
  strategy: Record<string, unknown>;
  segments: Array<{
    topic: string;
    ts_start?: number;
    ts_end?: number | null;
    content: string;
    rules?: string[];
  }>;
}

function openRouterHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY!}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
    "X-Title": process.env.OPENROUTER_APP_NAME || "Trading Coach",
  };
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

export function resolveYoutubeUrl(video: {
  youtube_url?: string | null;
  youtube_video_id?: string | null;
}): string | null {
  const url = video.youtube_url?.trim();
  if (url) return url;
  const id = video.youtube_video_id?.trim();
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  return null;
}

export async function analyzeYoutubeVideo(youtubeUrl: string): Promise<VideoAnalysis> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: VIDEO_MODEL,
      provider: { only: ["google-ai-studio"] },
      messages: [
        {
          role: "user",
          content: [
            { type: "video_url", video_url: { url: youtubeUrl } },
            { type: "text", text: ANALYSIS_PROMPT },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 16384,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "video_analysis",
          strict: false,
          schema: VIDEO_ANALYSIS_SCHEMA,
        },
      },
      plugins: [{ id: "response-healing" }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter video analysis ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter returned empty video analysis");

  return JSON.parse(extractJsonBlob(text)) as VideoAnalysis;
}

async function embedDocument(text: string): Promise<number[]> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      input_type: "search_document",
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter embeddings ${response.status}: ${body}`);
  }

  const result = (await response.json()) as {
    data?: Array<{ embedding: number[] }>;
  };
  const embedding = result.data?.[0]?.embedding;
  if (!embedding) throw new Error("OpenRouter returned no embedding");
  return embedding;
}

async function mergeStrategyProfile(
  existing: string,
  analysis: VideoAnalysis
): Promise<string> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: CHAT_MODEL,
      messages: [
        {
          role: "user",
          content: `Tienes un perfil de estrategia de trading existente y un nuevo análisis de video.
Fusiona la información en un único documento markdown completo que capture TODAS las reglas,
condiciones de entrada/salida, gestión de riesgo, indicadores y patrones del trader.

Redacta como manual de estrategia en segunda persona ("tu estrategia..."). No menciones videos, timestamps ni fuentes.

Perfil existente:
${existing || "Ninguno (primer video)"}

Nuevo análisis:
${JSON.stringify(analysis, null, 2)}

Genera un markdown estructurado con secciones claras. No pierdas ninguna regla del perfil existente ni del nuevo análisis.
Responde SOLO con el markdown.`,
        },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter merge ${response.status}: ${body}`);
  }

  const result = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return result.choices?.[0]?.message?.content?.trim() ?? "";
}

export interface VideoRow {
  id: string;
  user_id: string;
  filename: string;
  storage_path?: string | null;
  youtube_url?: string | null;
  youtube_video_id?: string | null;
}

export async function processYoutubeVideo(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createServiceClient>>,
  videoId: string,
  initialRecord?: Partial<VideoRow>
): Promise<void> {
  console.log(`[ingest] start youtube video_id=${videoId}`);

  await supabase
    .from("videos")
    .update({ status: "processing", error: null })
    .eq("id", videoId);

  const { data: video, error: fetchError } = await supabase
    .from("videos")
    .select("*")
    .eq("id", videoId)
    .single();

  if (fetchError || !video) {
    throw new Error(`Video ${videoId} not found: ${fetchError?.message}`);
  }

  const merged = { ...video, ...initialRecord };
  const youtubeUrl = resolveYoutubeUrl(merged);
  if (!youtubeUrl) {
    throw new Error("No youtube_url or youtube_video_id on this video");
  }

  console.log(`[ingest] analyzing ${youtubeUrl}`);

  await supabase.from("chunks").delete().eq("video_id", videoId);
  await supabase.from("video_analyses").delete().eq("video_id", videoId);

  const analysis = await analyzeYoutubeVideo(youtubeUrl);
  console.log(`[ingest] analysis done, segments=${analysis.segments?.length ?? 0}`);

  await supabase.from("video_analyses").insert({
    video_id: videoId,
    user_id: merged.user_id,
    transcript: analysis.transcript ?? "",
    structured_json: analysis,
  });

  let segments = analysis.segments ?? [];
  if (segments.length === 0) {
    segments = [
      {
        topic: "Estrategia completa",
        ts_start: 0,
        ts_end: null,
        content: JSON.stringify(analysis.strategy ?? {}),
        rules: [
          ...((analysis.strategy?.entry_rules as string[]) ?? []),
          ...((analysis.strategy?.exit_rules as string[]) ?? []),
        ],
      },
    ];
  }

  const chunkMetaBase: Record<string, unknown> = {
    filename: merged.filename,
    youtube_url: youtubeUrl,
  };
  if (merged.youtube_video_id) {
    chunkMetaBase.youtube_video_id = merged.youtube_video_id;
  }

  for (const segment of segments) {
    const topic = segment.topic ?? "General";
    let content = segment.content ?? "";
    if (topic && !content.startsWith(topic)) {
      content = `${topic}\n${content}`;
    }
    const rules = segment.rules ?? [];
    if (rules.length > 0) {
      content += `\nReglas: ${rules.join("; ")}`;
    }

    const embedding = await embedDocument(content);

    await supabase.from("chunks").insert({
      video_id: videoId,
      user_id: merged.user_id,
      content,
      metadata: {
        ...chunkMetaBase,
        topic: segment.topic,
        rules,
      },
      ts_start: segment.ts_start ?? null,
      ts_end: segment.ts_end ?? null,
      embedding,
    });
  }

  const { data: profile } = await supabase
    .from("strategy_profiles")
    .select("summary_md")
    .eq("user_id", merged.user_id)
    .maybeSingle();

  const newSummary = await mergeStrategyProfile(profile?.summary_md ?? "", analysis);

  await supabase.from("strategy_profiles").upsert({
    user_id: merged.user_id,
    summary_md: newSummary,
  });

  await supabase
    .from("videos")
    .update({ status: "processed", error: null })
    .eq("id", videoId);

  console.log(`[ingest] completed video_id=${videoId}`);
}

export async function forwardToWorker(videoId: string): Promise<void> {
  const workerUrl = process.env.WORKER_URL?.replace(/\/$/, "");
  const secret = process.env.WORKER_SECRET;
  if (!workerUrl || !secret) {
    throw new Error("WORKER_URL and WORKER_SECRET required for file video ingest");
  }

  const res = await fetch(`${workerUrl}/ingest/${videoId}`, {
    method: "POST",
    headers: { "X-Worker-Secret": secret },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Worker forward failed ${res.status}: ${body}`);
  }
}
