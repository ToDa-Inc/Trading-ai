export type VideoStatus = "pending" | "processing" | "processed" | "error";

export interface Video {
  id: string;
  user_id: string;
  storage_path: string | null;
  filename: string;
  duration_seconds: number | null;
  status: VideoStatus;
  error: string | null;
  gemini_file_uri: string | null;
  youtube_url: string | null;
  youtube_video_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  image_path: string | null;
  citations: Array<{ video_id: string; ts_start?: number; topic?: string }>;
  market_context?: MarketSnapshot | null;
  created_at: string;
}

export interface MarketSnapshot {
  symbol: string;
  timeframe: string | null;
  session: string;
  referencePrice: number;
  chartEntry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  entryVsReferencePips: number | null;
  stopPips: number | null;
  rewardPips: number | null;
  riskReward: string | null;
  source: string;
  asOf: string;
  freshness: "live" | "delayed" | "daily";
}

export interface ChunkMatch {
  id: string;
  video_id: string;
  content: string;
  metadata: Record<string, unknown>;
  ts_start: number | null;
  ts_end: number | null;
  similarity: number;
}

export type FeedbackRating = "positive" | "negative" | "correction";
export type FeedbackType =
  | "correct"
  | "wrong"
  | "missed_rule"
  | "too_generic"
  | "correction";
export type MemoryScope = "session" | "global_strategy";
export type MemoryCandidateStatus = "pending" | "approved" | "dismissed";

export interface ChatFeedback {
  id: string;
  user_id: string;
  session_id: string;
  message_id: string;
  rating: FeedbackRating;
  feedback_type: FeedbackType;
  comment: string | null;
  created_at: string;
}

export interface AgentMemoryCandidate {
  id: string;
  user_id: string;
  session_id: string | null;
  source_feedback_id: string | null;
  candidate_text: string;
  scope: MemoryScope;
  status: MemoryCandidateStatus;
  created_at: string;
  updated_at: string;
}

export interface AgentMemory {
  id: string;
  user_id: string;
  source_candidate_id: string | null;
  memory_text: string;
  scope: "global_strategy";
  created_at: string;
  updated_at: string;
}
