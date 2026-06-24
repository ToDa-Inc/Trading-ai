"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { MarketSnapshot } from "@/types/database";

interface AssessmentContextCardProps {
  snapshot: MarketSnapshot;
}

function formatPrice(price: number, symbol: string): string {
  if (symbol.includes("JPY") && !symbol.startsWith("JPY")) {
    return price.toFixed(3);
  }
  if (symbol.includes("XAU")) return price.toFixed(2);
  return price.toFixed(5);
}

export function AssessmentContextCard({ snapshot }: AssessmentContextCardProps) {
  const [expanded, setExpanded] = useState(false);

  const tf = snapshot.timeframe ? ` · ${snapshot.timeframe}` : "";
  const summary = `${snapshot.symbol}${tf} · ${snapshot.session} · Ref ${formatPrice(snapshot.referencePrice, snapshot.symbol)}`;

  return (
    <div className="mt-3 border-t border-zinc-700/40 pt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left text-xs text-zinc-400 hover:text-zinc-300"
      >
        <span>
          <span className="text-zinc-500">Contexto de mercado · </span>
          {summary}
        </span>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5 text-xs text-zinc-400">
          {snapshot.chartEntry !== null && (
            <p>
              Entrada en captura:{" "}
              <span className="text-zinc-300">
                {formatPrice(snapshot.chartEntry, snapshot.symbol)}
              </span>
              {snapshot.entryVsReferencePips !== null && (
                <span> ({snapshot.entryVsReferencePips} pips vs referencia)</span>
              )}
            </p>
          )}
          {(snapshot.stopPips !== null || snapshot.rewardPips !== null) && (
            <p>
              {snapshot.stopPips !== null && <span>Stop: {snapshot.stopPips} pips</span>}
              {snapshot.stopPips !== null && snapshot.rewardPips !== null && " · "}
              {snapshot.rewardPips !== null && <span>TP: {snapshot.rewardPips} pips</span>}
              {snapshot.riskReward && (
                <span className="text-emerald-400/80"> · R:R {snapshot.riskReward}</span>
              )}
            </p>
          )}
          <p className="text-zinc-500">
            Fuente: {snapshot.source} · actualización {snapshot.freshness === "daily" ? "diaria" : snapshot.freshness}
          </p>
          <p className="text-zinc-500 italic">
            Referencia de mercado. La evaluación sigue basada en tu estrategia.
          </p>
        </div>
      )}
    </div>
  );
}
