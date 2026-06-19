"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentMemory, AgentMemoryCandidate } from "@/types/database";

interface MemoryReviewPanelProps {
  onUpdated?: () => void;
}

export function MemoryReviewPanel({ onUpdated }: MemoryReviewPanelProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<AgentMemoryCandidate[]>([]);
  const [approved, setApproved] = useState<AgentMemory[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchMemories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/chat/memories");
      if (!res.ok) return;
      const data = await res.json();
      setPending(data.pending || []);
      setApproved(data.approved || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void fetchMemories();
  }, [open, fetchMemories]);

  const patchCandidate = async (
    candidateId: string,
    action: "approve" | "dismiss" | "edit",
    candidateText?: string
  ) => {
    const res = await fetch("/api/chat/memories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId, action, candidateText }),
    });
    if (!res.ok) return;
    setEditingId(null);
    setEditText("");
    await fetchMemories();
    onUpdated?.();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      >
        <Brain className="h-3.5 w-3.5" />
        Revisar aprendizajes
        {pending.length > 0 && (
          <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">
            {pending.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-4 top-14 z-20 w-80 rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium text-zinc-200">Aprendizajes del coach</h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {loading ? (
            <p className="text-xs text-zinc-500">Cargando...</p>
          ) : (
            <div className="max-h-72 space-y-4 overflow-y-auto">
              {pending.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-amber-400/90">Pendientes</p>
                  <ul className="space-y-2">
                    {pending.map((c) => (
                      <li
                        key={c.id}
                        className="rounded-lg border border-zinc-700/60 bg-zinc-800/50 p-2.5"
                      >
                        {editingId === c.id ? (
                          <div className="space-y-2">
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              rows={2}
                              className="w-full resize-none rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
                            />
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => patchCandidate(c.id, "approve", editText)}
                              >
                                Guardar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => setEditingId(null)}
                              >
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-xs leading-relaxed text-zinc-300">
                              {c.candidate_text}
                            </p>
                            <div className="mt-2 flex gap-1">
                              <button
                                type="button"
                                onClick={() => patchCandidate(c.id, "approve")}
                                className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-emerald-400 hover:bg-emerald-500/10"
                              >
                                <Check className="h-3 w-3" />
                                Aprobar
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(c.id);
                                  setEditText(c.candidate_text);
                                }}
                                className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-700/50"
                              >
                                <Pencil className="h-3 w-3" />
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => patchCandidate(c.id, "dismiss")}
                                className="rounded px-2 py-1 text-[10px] text-zinc-500 hover:bg-zinc-700/50"
                              >
                                Descartar
                              </button>
                            </div>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {approved.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-emerald-400/90">
                    Recordadas para futuras evaluaciones
                  </p>
                  <ul className="space-y-1.5">
                    {approved.map((m) => (
                      <li
                        key={m.id}
                        className="rounded-lg bg-zinc-800/30 px-2.5 py-2 text-xs text-zinc-400"
                      >
                        {m.memory_text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {pending.length === 0 && approved.length === 0 && (
                <p className="text-xs text-zinc-500">
                  Aún no hay aprendizajes. Corrige una respuesta del coach para empezar.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
