import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const [candidatesRes, memoriesRes] = await Promise.all([
    supabase
      .from("agent_memory_candidates")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["pending", "approved"])
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("agent_memories")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (candidatesRes.error) {
    return NextResponse.json({ error: candidatesRes.error.message }, { status: 500 });
  }
  if (memoriesRes.error) {
    return NextResponse.json({ error: memoriesRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    pending: (candidatesRes.data || []).filter((c) => c.status === "pending"),
    approved: memoriesRes.data || [],
    sessionApproved: (candidatesRes.data || []).filter(
      (c) => c.status === "approved" && c.scope === "session"
    ),
  });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = (await request.json()) as {
    candidateId?: string;
    action?: "approve" | "dismiss" | "edit";
    candidateText?: string;
  };

  const { candidateId, action, candidateText } = body;

  if (!candidateId || !action) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  const { data: candidate } = await supabase
    .from("agent_memory_candidates")
    .select("*")
    .eq("id", candidateId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!candidate) {
    return NextResponse.json({ error: "Candidato no encontrado" }, { status: 404 });
  }

  if (action === "dismiss") {
    const { error } = await supabase
      .from("agent_memory_candidates")
      .update({ status: "dismissed" })
      .eq("id", candidateId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ status: "dismissed" });
  }

  if (action === "edit") {
    if (!candidateText?.trim()) {
      return NextResponse.json({ error: "Texto requerido" }, { status: 400 });
    }

    const { data: updated, error } = await supabase
      .from("agent_memory_candidates")
      .update({ candidate_text: candidateText.trim() })
      .eq("id", candidateId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ candidate: updated });
  }

  if (action === "approve") {
    const text = candidateText?.trim() || candidate.candidate_text;

    const { data: memory, error: memoryError } = await supabase
      .from("agent_memories")
      .insert({
        user_id: user.id,
        source_candidate_id: candidateId,
        memory_text: text,
        scope: "global_strategy",
      })
      .select()
      .single();

    if (memoryError) {
      return NextResponse.json({ error: memoryError.message }, { status: 500 });
    }

    const { error: updateError } = await supabase
      .from("agent_memory_candidates")
      .update({ status: "approved", candidate_text: text })
      .eq("id", candidateId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ memory, status: "approved" });
  }

  return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
}
