const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const VIDEO_MODEL =
  process.env.OPENROUTER_VIDEO_MODEL || "google/gemini-3-flash-preview";
const CHAT_MODEL =
  process.env.OPENROUTER_CHAT_MODEL || "google/gemini-3.1-flash-lite";
const EMBEDDING_MODEL =
  process.env.OPENROUTER_EMBEDDING_MODEL || "openai/text-embedding-3-small";
const EMBEDDING_DIMENSIONS = Number(
  process.env.OPENROUTER_EMBEDDING_DIMENSIONS || "768"
);

const ANALYSIS_PROMPT = `Analiza este video de trading como si estuvieras construyendo un playbook senior de la estrategia.
Usa TODO lo disponible: audio, pantalla, gráficos, dibujos, indicadores, zonas marcadas, velas, estructura, liquidez y ejemplos visibles.

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
  "visual_observations": [
    "observación visual concreta del gráfico/pantalla que afecte la estrategia"
  ],
  "decision_points": [
    "lógica de decisión: por qué un setup sería válido, inválido o de baja calidad"
  ],
  "atomic_rules": [
    {
      "type": "entry_rule | exit_rule | risk_rule | poi_rule | fvg_rule | liquidity_rule | structure_rule | no_trade_rule | execution_rule",
      "rule": "regla atómica y accionable en una frase",
      "conditions": ["condición necesaria 1", "condición necesaria 2"],
      "visual_cues": ["señal visual en el gráfico/pantalla"],
      "priority": "high | medium | low"
    }
  ],
  "valid_examples": [
    {
      "setup": "setup o patrón",
      "context": "contexto visual/estructural",
      "decision": "por qué sería válido",
      "reasons": ["razón 1", "razón 2"]
    }
  ],
  "invalid_examples": [
    {
      "setup": "setup o patrón",
      "context": "contexto visual/estructural",
      "decision": "por qué sería inválido o evitable",
      "reasons": ["razón 1", "razón 2"]
    }
  ],
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

Sé exhaustivo. Captura tanto lo que el trader DICE como lo que se VE en el gráfico. Convierte cada criterio importante en reglas atómicas.
No escribas "en el video", "se ve en pantalla" ni referencias a timestamps. Redacta como conocimiento reutilizable de estrategia.
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
    visual_observations: { type: "array", items: { type: "string" } },
    decision_points: { type: "array", items: { type: "string" } },
    atomic_rules: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          rule: { type: "string" },
          conditions: { type: "array", items: { type: "string" } },
          visual_cues: { type: "array", items: { type: "string" } },
          priority: { type: "string" },
        },
        required: ["type", "rule"],
      },
    },
    valid_examples: {
      type: "array",
      items: {
        type: "object",
        properties: {
          setup: { type: "string" },
          context: { type: "string" },
          decision: { type: "string" },
          reasons: { type: "array", items: { type: "string" } },
        },
      },
    },
    invalid_examples: {
      type: "array",
      items: {
        type: "object",
        properties: {
          setup: { type: "string" },
          context: { type: "string" },
          decision: { type: "string" },
          reasons: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  required: ["transcript", "strategy", "segments"],
};

export interface VideoAnalysis {
  transcript: string;
  strategy: Record<string, unknown>;
  visual_observations?: string[];
  decision_points?: string[];
  atomic_rules?: Array<{
    type?: string;
    rule: string;
    conditions?: string[];
    visual_cues?: string[];
    priority?: string;
  }>;
  valid_examples?: StrategyExample[];
  invalid_examples?: StrategyExample[];
  segments: Array<{
    topic: string;
    ts_start?: number;
    ts_end?: number | null;
    content: string;
    rules?: string[];
  }>;
}

interface StrategyExample {
  setup?: string;
  context?: string;
  decision?: string;
  reasons?: string[];
}

interface KnowledgeChunk {
  content: string;
  metadata: Record<string, unknown>;
  ts_start?: number | null;
  ts_end?: number | null;
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
      reasoning: { effort: "high" },
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

function asList<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function formatRule(rule: NonNullable<VideoAnalysis["atomic_rules"]>[number]): string {
  const parts = [
    `Tipo: ${rule.type || "rule"}`,
    `Regla: ${rule.rule}`,
  ];
  if (asList(rule.conditions).length > 0) {
    parts.push(`Condiciones: ${asList(rule.conditions).join("; ")}`);
  }
  if (asList(rule.visual_cues).length > 0) {
    parts.push(`Señales visuales: ${asList(rule.visual_cues).join("; ")}`);
  }
  if (rule.priority) {
    parts.push(`Prioridad: ${rule.priority}`);
  }
  return parts.filter((part) => part.trim()).join("\n");
}

function formatExample(example: StrategyExample, valid: boolean): string {
  const parts = [
    valid ? "Ejemplo válido" : "Ejemplo inválido / evitar",
    example.setup && `Setup: ${example.setup}`,
    example.context && `Contexto: ${example.context}`,
    example.decision && `Decisión: ${example.decision}`,
  ].filter(Boolean) as string[];
  if (asList(example.reasons).length > 0) {
    parts.push(`Razones: ${asList(example.reasons).join("; ")}`);
  }
  return parts.join("\n");
}

function buildKnowledgeChunks(analysis: VideoAnalysis): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];

  for (const rule of asList(analysis.atomic_rules)) {
    if (!rule?.rule) continue;
    chunks.push({
      content: formatRule(rule),
      metadata: {
        knowledge_type: "atomic_rule",
        rule_type: rule.type,
        priority: rule.priority,
        conditions: asList(rule.conditions),
        visual_cues: asList(rule.visual_cues),
      },
    });
  }

  for (const observation of asList(analysis.visual_observations)) {
    if (!observation) continue;
    chunks.push({
      content: `Observación visual de estrategia:\n${observation}`,
      metadata: { knowledge_type: "visual_observation" },
    });
  }

  for (const decision of asList(analysis.decision_points)) {
    if (!decision) continue;
    chunks.push({
      content: `Lógica de decisión:\n${decision}`,
      metadata: { knowledge_type: "decision_point" },
    });
  }

  for (const example of asList(analysis.valid_examples)) {
    chunks.push({
      content: formatExample(example, true),
      metadata: { knowledge_type: "valid_example", setup: example.setup },
    });
  }

  for (const example of asList(analysis.invalid_examples)) {
    chunks.push({
      content: formatExample(example, false),
      metadata: { knowledge_type: "invalid_example", setup: example.setup },
    });
  }

  for (const segment of asList(analysis.segments)) {
    const topic = segment.topic ?? "General";
    let content = segment.content ?? "";
    if (topic && !content.startsWith(topic)) {
      content = `${topic}\n${content}`;
    }
    const rules = asList(segment.rules);
    if (rules.length > 0) {
      content += `\nReglas: ${rules.join("; ")}`;
    }
    if (!content.trim()) continue;
    chunks.push({
      content,
      metadata: {
        knowledge_type: "segment",
        topic,
        rules,
      },
      ts_start: segment.ts_start ?? null,
      ts_end: segment.ts_end ?? null,
    });
  }

  if (chunks.length === 0) {
    chunks.push({
      content: JSON.stringify(analysis.strategy ?? {}),
      metadata: { knowledge_type: "strategy" },
    });
  }

  return chunks;
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

  const chunkMetaBase: Record<string, unknown> = {
    filename: merged.filename,
    youtube_url: youtubeUrl,
  };
  if (merged.youtube_video_id) {
    chunkMetaBase.youtube_video_id = merged.youtube_video_id;
  }

  for (const chunk of buildKnowledgeChunks(analysis)) {
    const embedding = await embedDocument(chunk.content);

    await supabase.from("chunks").insert({
      video_id: videoId,
      user_id: merged.user_id,
      content: chunk.content,
      metadata: {
        ...chunkMetaBase,
        ...chunk.metadata,
      },
      ts_start: chunk.ts_start ?? null,
      ts_end: chunk.ts_end ?? null,
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
