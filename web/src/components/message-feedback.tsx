"use client";

import { useState } from "react";
import { Check, MessageSquarePlus, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FeedbackType } from "@/types/database";

interface MessageFeedbackProps {
  messageId: string;
  sessionId: string;
}

type FeedbackState = "idle" | "saved" | "composer";

export function MessageFeedback({ messageId, sessionId }: MessageFeedbackProps) {
  const [state, setState] = useState<FeedbackState>("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [savedLabel, setSavedLabel] = useState("");
  const [correction, setCorrection] = useState("");

  const submitFeedback = async (
    feedbackType: FeedbackType,
    options?: { comment?: string; proposeAsStrategyRule?: boolean }
  ) => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/chat/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          sessionId,
          feedbackType,
          comment: options?.comment,
          proposeAsStrategyRule: options?.proposeAsStrategyRule,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Error al guardar feedback");
      }

      const data = await res.json();
      setSavedLabel(data.message || "Guardado");
      setState("saved");
      setCorrection("");
    } catch {
      setState("idle");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (state === "saved") {
    return (
      <p className="mt-2 text-xs text-emerald-400/90">{savedLabel}</p>
    );
  }

  if (state === "composer") {
    return (
      <div className="mt-3 space-y-2 border-t border-zinc-700/50 pt-3">
        <p className="text-xs text-zinc-400">¿Qué debería recordar el coach?</p>
        <textarea
          value={correction}
          onChange={(e) => setCorrection(e.target.value)}
          placeholder="Cuéntale qué se equivocó o qué regla faltó..."
          rows={2}
          className="w-full resize-none rounded-lg border border-zinc-600 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!correction.trim() || isSubmitting}
            onClick={() =>
              submitFeedback("correction", { comment: correction, proposeAsStrategyRule: false })
            }
          >
            Aplicar a esta conversación
          </Button>
          <Button
            size="sm"
            disabled={!correction.trim() || isSubmitting}
            onClick={() =>
              submitFeedback("correction", { comment: correction, proposeAsStrategyRule: true })
            }
          >
            Guardar como regla
          </Button>
          <button
            type="button"
            onClick={() => setState("idle")}
            className="rounded-lg p-1.5 text-zinc-500 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
      <span className="mr-1 text-xs text-zinc-500">¿Te fue útil?</span>
      <button
        type="button"
        disabled={isSubmitting}
        onClick={() => submitFeedback("correct")}
        className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-700/50 hover:text-emerald-400"
        title="Correcto"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={isSubmitting}
        onClick={() => submitFeedback("wrong")}
        className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-700/50 hover:text-red-400"
        title="Incorrecto"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={isSubmitting}
        onClick={() => submitFeedback("missed_rule")}
        className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700/50 hover:text-amber-400"
      >
        Faltó una regla
      </button>
      <button
        type="button"
        disabled={isSubmitting}
        onClick={() => submitFeedback("too_generic")}
        className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200"
      >
        Muy genérico
      </button>
      <button
        type="button"
        disabled={isSubmitting}
        onClick={() => setState("composer")}
        className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700/50 hover:text-emerald-400"
      >
        <MessageSquarePlus className="mr-1 inline h-3.5 w-3.5" />
        Corregir
      </button>
      {isSubmitting && (
        <Check className="h-3.5 w-3.5 animate-pulse text-zinc-500" />
      )}
    </div>
  );
}
