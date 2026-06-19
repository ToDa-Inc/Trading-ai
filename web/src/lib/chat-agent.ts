import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chatCompletionJson,
  embedQuery,
  streamChatCompletion,
  type ChatMessageParam,
  type ChunkMatch,
} from "@/lib/openrouter";

export type ChatIntent = "trade_assessment" | "strategy_question" | "followup";

export type AgentStreamEvent =
  | { type: "status"; text: string }
  | { type: "intent"; intent: ChatIntent }
  | { type: "token"; text: string }
  | {
      type: "metadata";
      intent: ChatIntent;
      citations: Array<{ video_id: string; ts_start?: number; topic?: string }>;
    }
  | { type: "done" }
  | { type: "error"; error: string };

export interface TradeFacts {
  direction: string | null;
  asset: string | null;
  timeframe: string | null;
  setup_type: string | null;
  entry_zone: string | null;
  stop_loss: string | null;
  take_profit: string | null;
  indicators: string[];
  patterns: string[];
  uncertainty_notes: string[];
}

interface SessionMessage {
  role: "user" | "assistant";
  content: string;
}

const HISTORY_LIMIT = 10;
const RETRIEVAL_PER_QUERY = 12;
const RETRIEVAL_MAX = 20;

const TRADE_ASSESSMENT_PROMPT = `Eres un evaluador de operaciones de trading. Tu trabajo es juzgar si una operación cumple la estrategia personal del usuario.

REGLAS ESTRICTAS:
1. Usa ÚNICAMENTE el perfil de estrategia, los fragmentos de conocimiento, las correcciones aprobadas del usuario y los hechos observados proporcionados.
2. Las correcciones aprobadas del usuario tienen prioridad sobre interpretaciones anteriores del asistente.
2. Si falta información para evaluar, indica "Información insuficiente" como recomendación y lista qué falta confirmar.
3. Nunca inventes reglas ni datos del gráfico que no estén en el contexto.
4. Presenta el juicio como criterios del usuario ("tu estrategia indica...", "según tus reglas...").
5. NUNCA menciones videos, timestamps, fragmentos ni fuentes.
6. Sigue este proceso interno: identificar setup → revisar reglas de entrada → revisar gestión de riesgo → revisar condiciones de no operar → emitir veredicto.

FORMATO OBLIGATORIO:
- **Recomendación:** Alta / Media / Baja / No recomendada / Información insuficiente
- **Veredicto:** una frase directa
- **Criterios que cumple:** lista breve
- **Criterios que viola o faltan:** lista breve
- **Riesgos / condiciones de no operar:** lista breve
- **Qué confirmar antes de operar:** lista breve (si aplica)

Responde en español, claro y directo. Usa markdown ligero.`;

const STRATEGY_QA_PROMPT = `Eres un coach de trading que responde preguntas sobre la estrategia personal del usuario.

REGLAS ESTRICTAS:
1. Responde ÚNICAMENTE con el conocimiento del perfil y los fragmentos proporcionados.
2. Si la información no está en el contexto, di "No tengo esa información en tu estrategia".
3. Nunca inventes reglas ni recomendaciones que el usuario no haya definido.
4. Presenta el conocimiento como reglas del propio usuario ("tu estrategia indica...").
5. NUNCA menciones videos, timestamps, fragmentos ni fuentes.
6. Responde en español, claro y directo. Usa markdown ligero.`;

const FOLLOWUP_PROMPT = `Eres un coach de trading en una conversación continua. El usuario hace seguimiento sobre su estrategia o una evaluación previa.

REGLAS:
1. Usa el historial de conversación, el perfil de estrategia y los fragmentos proporcionados.
2. Mantén coherencia con mensajes anteriores del asistente en esta sesión.
3. No inventes reglas. Si falta contexto, dilo.
4. NUNCA menciones videos, timestamps ni fuentes.
5. Si el seguimiento implica evaluar una operación, usa el formato de evaluación con Recomendación, Veredicto, criterios cumplidos/violados.
6. Responde en español, claro y directo.`;

const TRADE_FACTS_SCHEMA = {
  type: "object",
  properties: {
    direction: { type: ["string", "null"] },
    asset: { type: ["string", "null"] },
    timeframe: { type: ["string", "null"] },
    setup_type: { type: ["string", "null"] },
    entry_zone: { type: ["string", "null"] },
    stop_loss: { type: ["string", "null"] },
    take_profit: { type: ["string", "null"] },
    indicators: { type: "array", items: { type: "string" } },
    patterns: { type: "array", items: { type: "string" } },
    uncertainty_notes: { type: "array", items: { type: "string" } },
  },
  required: [
    "direction",
    "asset",
    "timeframe",
    "setup_type",
    "entry_zone",
    "stop_loss",
    "take_profit",
    "indicators",
    "patterns",
    "uncertainty_notes",
  ],
};

const ASSESSMENT_KEYWORDS =
  /\b(evalúa|evalua|operaci[oó]n|trade|setup|entrada|salida|long|short|compra|venta|captura|tomar|entrar)\b/i;

function classifyIntent(
  message: string,
  hasImage: boolean,
  history: SessionMessage[]
): ChatIntent {
  if (hasImage) return "trade_assessment";
  if (ASSESSMENT_KEYWORDS.test(message)) return "trade_assessment";
  if (
    history.length > 0 &&
    /^(y |entonces|qué tal|que tal|y si|pero |ok |vale )/i.test(message.trim())
  ) {
    return "followup";
  }
  return "strategy_question";
}

function systemPromptForIntent(intent: ChatIntent): string {
  switch (intent) {
    case "trade_assessment":
      return TRADE_ASSESSMENT_PROMPT;
    case "followup":
      return FOLLOWUP_PROMPT;
    default:
      return STRATEGY_QA_PROMPT;
  }
}

function tradeFactsToQuery(facts: TradeFacts): string {
  const parts = [
    facts.direction,
    facts.asset,
    facts.timeframe,
    facts.setup_type,
    ...facts.indicators,
    ...facts.patterns,
    facts.entry_zone,
  ].filter(Boolean);
  return parts.join(" ") || "evaluación operación trading entrada salida";
}

async function extractTradeFacts(
  imageBase64: string,
  imageMimeType: string,
  userMessage: string
): Promise<TradeFacts> {
  const result = await chatCompletionJson<TradeFacts>({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${imageMimeType};base64,${imageBase64}`,
            },
          },
          {
            type: "text",
            text: `Analiza esta captura de trading. Extrae SOLO lo visible. No inventes datos.
Contexto del usuario: ${userMessage || "Evaluar operación"}

Devuelve JSON con: direction, asset, timeframe, setup_type, entry_zone, stop_loss, take_profit, indicators[], patterns[], uncertainty_notes[].
Usa null para campos no visibles. En uncertainty_notes indica qué no se puede confirmar.`,
          },
        ],
      },
    ],
    schemaName: "trade_facts",
    schema: TRADE_FACTS_SCHEMA,
    temperature: 0.1,
  });

  return {
    direction: result.direction ?? null,
    asset: result.asset ?? null,
    timeframe: result.timeframe ?? null,
    setup_type: result.setup_type ?? null,
    entry_zone: result.entry_zone ?? null,
    stop_loss: result.stop_loss ?? null,
    take_profit: result.take_profit ?? null,
    indicators: result.indicators ?? [],
    patterns: result.patterns ?? [],
    uncertainty_notes: result.uncertainty_notes ?? [],
  };
}

function buildRetrievalQueries(
  message: string,
  intent: ChatIntent,
  tradeFacts?: TradeFacts
): string[] {
  const queries = new Set<string>();

  const base = message.trim() || "evaluación operación trading";
  queries.add(base);

  if (intent === "trade_assessment") {
    queries.add("reglas de entrada condiciones setup patrón indicadores");
    queries.add("gestión de riesgo stop loss tamaño posición");
    queries.add("condiciones no operar evitar operación filtros");
    if (tradeFacts) {
      queries.add(tradeFactsToQuery(tradeFacts));
    }
  }

  return [...queries];
}

async function retrieveChunks(
  serviceClient: SupabaseClient,
  userId: string,
  queries: string[]
): Promise<ChunkMatch[]> {
  const embeddings = await Promise.all(queries.map((q) => embedQuery(q)));

  const results = await Promise.all(
    embeddings.map((query_embedding) =>
      serviceClient.rpc("match_chunks", {
        query_embedding,
        match_count: RETRIEVAL_PER_QUERY,
        filter_user_id: userId,
      })
    )
  );

  const byId = new Map<string, ChunkMatch>();

  for (const { data } of results) {
    for (const chunk of (data as ChunkMatch[]) || []) {
      const existing = byId.get(chunk.id);
      if (!existing || chunk.similarity > existing.similarity) {
        byId.set(chunk.id, chunk);
      }
    }
  }

  return [...byId.values()]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, RETRIEVAL_MAX);
}

function chunksToCitations(
  chunks: ChunkMatch[]
): Array<{ video_id: string; ts_start?: number; topic?: string }> {
  const seen = new Set<string>();
  const citations: Array<{ video_id: string; ts_start?: number; topic?: string }> = [];

  for (const chunk of chunks) {
    const topic = (chunk.metadata?.topic as string) || undefined;
    const key = `${chunk.video_id}:${chunk.ts_start ?? ""}:${topic ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      video_id: chunk.video_id,
      ts_start: chunk.ts_start ?? undefined,
      topic,
    });
  }

  return citations;
}

function formatTradeFacts(facts: TradeFacts): string {
  const lines = [
    facts.direction && `- Dirección: ${facts.direction}`,
    facts.asset && `- Activo: ${facts.asset}`,
    facts.timeframe && `- Temporalidad: ${facts.timeframe}`,
    facts.setup_type && `- Setup: ${facts.setup_type}`,
    facts.entry_zone && `- Zona de entrada: ${facts.entry_zone}`,
    facts.stop_loss && `- Stop loss: ${facts.stop_loss}`,
    facts.take_profit && `- Take profit: ${facts.take_profit}`,
    facts.indicators.length > 0 &&
      `- Indicadores visibles: ${facts.indicators.join(", ")}`,
    facts.patterns.length > 0 && `- Patrones: ${facts.patterns.join(", ")}`,
    facts.uncertainty_notes.length > 0 &&
      `- Incertidumbres: ${facts.uncertainty_notes.join("; ")}`,
  ].filter(Boolean);

  return lines.join("\n") || "No se pudieron extraer hechos concretos de la captura.";
}

function buildKnowledgeContext(chunks: ChunkMatch[]): string {
  if (chunks.length === 0) {
    return "No hay conocimiento adicional relevante para esta consulta.";
  }

  return chunks
    .map((c, i) => {
      const topic = (c.metadata?.topic as string) || `Área ${i + 1}`;
      const relevance = Math.round(c.similarity * 100);
      return `### ${topic} (relevancia ${relevance}%)\n${c.content}`;
    })
    .join("\n\n");
}

function buildUserPrompt(input: {
  message: string;
  strategyProfile: string;
  chunks: ChunkMatch[];
  tradeFacts?: TradeFacts;
  hasStrategy: boolean;
  approvedMemories: string[];
  sessionMemories: string[];
}): string {
  const sections = [
    "## Perfil de estrategia del usuario",
    input.strategyProfile || "Aún no hay perfil de estrategia definido.",
  ];

  if (input.approvedMemories.length > 0) {
    sections.push(
      "",
      "## Correcciones aprobadas por el usuario",
      "Estas correcciones vienen directamente del usuario y tienen prioridad al evaluar operaciones:",
      ...input.approvedMemories.map((m) => `- ${m}`)
    );
  }

  if (input.sessionMemories.length > 0) {
    sections.push(
      "",
      "## Correcciones de esta conversación",
      "Aplican solo en esta sesión y tienen prioridad sobre interpretaciones anteriores:",
      ...input.sessionMemories.map((m) => `- ${m}`)
    );
  }

  sections.push(
    "",
    "## Conocimiento relevante de la estrategia",
    buildKnowledgeContext(input.chunks)
  );

  if (input.tradeFacts) {
    sections.push("", "## Hechos observados en la captura", formatTradeFacts(input.tradeFacts));
  }

  if (!input.hasStrategy) {
    sections.push(
      "",
      "## Aviso",
      "El usuario aún no tiene estrategia indexada. No puedes evaluar operaciones con criterios propios. Indica que debe subir videos explicando su técnica."
    );
  }

  sections.push("", "## Consulta del usuario", input.message);

  return sections.join("\n");
}

function buildMessages(input: {
  intent: ChatIntent;
  history: SessionMessage[];
  userPrompt: string;
  imageBase64?: string;
  imageMimeType?: string;
}): ChatMessageParam[] {
  const messages: ChatMessageParam[] = [
    { role: "system", content: systemPromptForIntent(input.intent) },
  ];

  for (const msg of input.history) {
    messages.push({ role: msg.role, content: msg.content });
  }

  if (input.imageBase64 && input.imageMimeType) {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: input.userPrompt },
        {
          type: "image_url",
          image_url: {
            url: `data:${input.imageMimeType};base64,${input.imageBase64}`,
          },
        },
      ],
    });
  } else {
    messages.push({ role: "user", content: input.userPrompt });
  }

  return messages;
}

async function loadLearningMemories(
  serviceClient: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<{ approved: string[]; session: string[] }> {
  const [memoriesRes, sessionRes] = await Promise.all([
    serviceClient
      .from("agent_memories")
      .select("memory_text")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    serviceClient
      .from("agent_memory_candidates")
      .select("candidate_text")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .eq("scope", "session")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return {
    approved: (memoriesRes.data || []).map((m) => m.memory_text as string),
    session: (sessionRes.data || []).map((c) => c.candidate_text as string),
  };
}

const NO_STRATEGY_RESPONSE = `**Recomendación:** Información insuficiente

**Veredicto:** Aún no tengo tu estrategia cargada para evaluar operaciones.

**Criterios que cumple:**
- Ninguno (no hay estrategia indexada)

**Criterios que viola o faltan:**
- No hay reglas de entrada, salida ni gestión de riesgo disponibles

**Riesgos / condiciones de no operar:**
- Evaluar sin estrategia definida no es posible de forma fiable

**Qué confirmar antes de operar:**
- Sube videos explicando tu técnica en la sección **Videos** y vuelve cuando estén procesados`;

export interface RunChatAgentInput {
  serviceClient: SupabaseClient;
  userId: string;
  sessionId: string;
  message: string;
  imageBase64?: string;
  imageMimeType?: string;
}

export async function* runChatAgent(
  input: RunChatAgentInput
): AsyncGenerator<AgentStreamEvent> {
  try {
    const { data: historyRows } = await input.serviceClient
      .from("chat_messages")
      .select("role, content")
      .eq("session_id", input.sessionId)
      .order("created_at", { ascending: true });

    let history = ((historyRows as SessionMessage[]) || []).filter((m) =>
      m.content?.trim()
    );
    const last = history[history.length - 1];
    if (last?.role === "user" && last.content === input.message) {
      history = history.slice(0, -1);
    }
    history = history.slice(-HISTORY_LIMIT);

    const intent = classifyIntent(
      input.message,
      Boolean(input.imageBase64),
      history
    );
    yield { type: "intent", intent };

    const { data: profile } = await input.serviceClient
      .from("strategy_profiles")
      .select("summary_md")
      .eq("user_id", input.userId)
      .maybeSingle();

    const strategyProfile = profile?.summary_md?.trim() || "";
    const hasStrategy = strategyProfile.length > 0;

    let tradeFacts: TradeFacts | undefined;

    if (input.imageBase64 && input.imageMimeType) {
      yield { type: "status", text: "Analizando captura..." };
      tradeFacts = await extractTradeFacts(
        input.imageBase64,
        input.imageMimeType,
        input.message
      );
    }

    yield { type: "status", text: "Buscando reglas relevantes..." };
    const queries = buildRetrievalQueries(input.message, intent, tradeFacts);
    const chunks = await retrieveChunks(
      input.serviceClient,
      input.userId,
      queries
    );

    const hasKnowledge = hasStrategy || chunks.length > 0;

    if (intent === "trade_assessment" && !hasKnowledge) {
      yield { type: "status", text: "Preparando respuesta..." };
      yield { type: "token", text: NO_STRATEGY_RESPONSE };
      yield {
        type: "metadata",
        intent,
        citations: [],
      };
      yield { type: "done" };
      return;
    }

    yield { type: "status", text: "Comparando contra tu estrategia..." };

    const learningMemories = await loadLearningMemories(
      input.serviceClient,
      input.userId,
      input.sessionId
    );

    const userPrompt = buildUserPrompt({
      message: input.message,
      strategyProfile,
      chunks,
      tradeFacts,
      hasStrategy,
      approvedMemories: learningMemories.approved,
      sessionMemories: learningMemories.session,
    });

    const messages = buildMessages({
      intent,
      history,
      userPrompt,
      imageBase64: input.imageBase64,
      imageMimeType: input.imageMimeType,
    });

    const citations = chunksToCitations(chunks);

    for await (const token of streamChatCompletion(messages, { temperature: 0.15 })) {
      yield { type: "token", text: token };
    }

    yield { type: "metadata", intent, citations };
    yield { type: "done" };
  } catch (err) {
    yield {
      type: "error",
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}
