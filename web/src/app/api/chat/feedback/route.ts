import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { FeedbackRating, FeedbackType, MemoryScope } from "@/types/database";

function ratingForType(feedbackType: FeedbackType): FeedbackRating {
  if (feedbackType === "correct") return "positive";
  if (feedbackType === "correction") return "correction";
  return "negative";
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = (await request.json()) as {
    messageId?: string;
    sessionId?: string;
    feedbackType?: FeedbackType;
    comment?: string;
    proposeAsStrategyRule?: boolean;
  };

  const { messageId, sessionId, feedbackType, comment, proposeAsStrategyRule } = body;

  if (!messageId || !sessionId || !feedbackType) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  if (feedbackType === "correction" && !comment?.trim()) {
    return NextResponse.json({ error: "La corrección requiere texto" }, { status: 400 });
  }

  const { data: message } = await supabase
    .from("chat_messages")
    .select("id")
    .eq("id", messageId)
    .eq("user_id", user.id)
    .eq("session_id", sessionId)
    .maybeSingle();

  if (!message) {
    return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
  }

  const { data: feedback, error: feedbackError } = await supabase
    .from("chat_feedback")
    .insert({
      user_id: user.id,
      session_id: sessionId,
      message_id: messageId,
      rating: ratingForType(feedbackType),
      feedback_type: feedbackType,
      comment: comment?.trim() || null,
    })
    .select()
    .single();

  if (feedbackError) {
    return NextResponse.json({ error: feedbackError.message }, { status: 500 });
  }

  let candidateId: string | null = null;
  let candidateStatus: string | null = null;

  if (feedbackType === "correction" && comment?.trim()) {
    const scope: MemoryScope = proposeAsStrategyRule ? "global_strategy" : "session";
    const status = scope === "session" ? "approved" : "pending";

    const { data: candidate, error: candidateError } = await supabase
      .from("agent_memory_candidates")
      .insert({
        user_id: user.id,
        session_id: sessionId,
        source_feedback_id: feedback.id,
        candidate_text: comment.trim(),
        scope,
        status,
      })
      .select()
      .single();

    if (candidateError) {
      return NextResponse.json({ error: candidateError.message }, { status: 500 });
    }

    candidateId = candidate.id;
    candidateStatus = candidate.status;

    if (scope === "global_strategy" && status === "pending") {
      // stays pending until user approves via memories API
    }
  }

  return NextResponse.json({
    feedback,
    candidateId,
    candidateStatus,
    message:
      feedbackType === "correction"
        ? proposeAsStrategyRule
          ? "Corrección pendiente de revisión"
          : "Corrección aplicada a esta conversación"
        : "Feedback guardado",
  });
}
