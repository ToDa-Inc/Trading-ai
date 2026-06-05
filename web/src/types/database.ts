export type VideoStatus = "pending" | "processing" | "processed" | "error";

export interface Video {
  id: string;
  user_id: string;
  storage_path: string;
  filename: string;
  duration_seconds: number | null;
  status: VideoStatus;
  error: string | null;
  gemini_file_uri: string | null;
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
  created_at: string;
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
