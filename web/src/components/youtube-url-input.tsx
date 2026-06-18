"use client";

import { useState } from "react";
import Image from "next/image";
import { Link2, Loader2, PlayCircle, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  extractYoutubeVideoId,
  fetchYoutubeMetadata,
  parseYoutubeUrls,
  youtubeThumbnailUrl,
} from "@/lib/youtube";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PendingYoutube {
  url: string;
  videoId: string;
  title: string;
  thumbnailUrl: string;
  status: "pending" | "adding" | "done" | "error";
  error?: string;
}

interface YoutubeUrlInputProps {
  onAddComplete: () => void;
}

export function YoutubeUrlInput({ onAddComplete }: YoutubeUrlInputProps) {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<PendingYoutube[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);

  const addFromInput = async () => {
    const urls = parseYoutubeUrls(input);
    if (urls.length === 0) {
      setLookupError("Pega una URL válida de YouTube (youtube.com o youtu.be)");
      return;
    }

    setLookupError(null);
    setIsLookingUp(true);

    const newItems: PendingYoutube[] = [];

    for (const url of urls) {
      const videoId = extractYoutubeVideoId(url)!;
      const alreadyQueued = pending.some((p) => p.videoId === videoId);
      if (alreadyQueued) continue;

      const meta = await fetchYoutubeMetadata(url);
      newItems.push({
        url,
        videoId,
        title: meta?.title ?? `YouTube — ${videoId}`,
        thumbnailUrl: meta?.thumbnail_url ?? youtubeThumbnailUrl(videoId),
        status: "pending",
      });
    }

    setIsLookingUp(false);

    if (newItems.length === 0) {
      setLookupError("Esa URL ya está en la lista");
      return;
    }

    setPending((prev) => [...prev, ...newItems]);
    setInput("");
  };

  const removePending = (videoId: string) => {
    setPending((prev) => prev.filter((p) => p.videoId !== videoId));
  };

  const addAll = async () => {
    const toAdd = pending.filter((p) => p.status === "pending");
    if (toAdd.length === 0) return;

    setIsAdding(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsAdding(false);
      return;
    }

    for (const item of toAdd) {
      setPending((prev) =>
        prev.map((p) => (p.videoId === item.videoId ? { ...p, status: "adding" } : p))
      );

      try {
        const { error } = await supabase.from("videos").insert({
          user_id: user.id,
          storage_path: null,
          filename: item.title,
          youtube_url: item.url,
          youtube_video_id: item.videoId,
        });

        if (error) throw error;

        setPending((prev) =>
          prev.map((p) => (p.videoId === item.videoId ? { ...p, status: "done" } : p))
        );
      } catch (err) {
        setPending((prev) =>
          prev.map((p) =>
            p.videoId === item.videoId
              ? {
                  ...p,
                  status: "error",
                  error: err instanceof Error ? err.message : "Error al añadir",
                }
              : p
          )
        );
      }
    }

    setIsAdding(false);
    onAddComplete();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData("text");
    const urls = parseYoutubeUrls(pasted);
    if (urls.length > 1) {
      e.preventDefault();
      setInput((prev) => (prev ? `${prev}\n${pasted}` : pasted));
    }
  };

  const pendingCount = pending.filter((p) => p.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
        <div className="mb-3 flex items-center gap-2">
          <PlayCircle className="h-5 w-5 text-red-500" />
          <h3 className="text-sm font-medium text-zinc-200">Añadir desde YouTube</h3>
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          Pega URLs de videos públicos de trading. La IA analizará audio y contenido visual
          (gráficos, indicadores, etc.) para tu memoria de estrategia.
        </p>

        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setLookupError(null);
            }}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void addFromInput();
              }
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            rows={2}
            className={cn(
              "min-w-0 flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2",
              "text-sm text-zinc-200 placeholder:text-zinc-600",
              "focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
            )}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void addFromInput()}
            disabled={!input.trim() || isLookingUp}
            className="shrink-0 self-end"
          >
            {isLookingUp ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
          </Button>
        </div>
        {lookupError && <p className="mt-2 text-xs text-red-400">{lookupError}</p>}
      </div>

      {pending.length > 0 && (
        <div className="space-y-2">
          {pending.map((item) => (
            <div
              key={item.videoId}
              className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3"
            >
              <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-zinc-800">
                <Image
                  src={item.thumbnailUrl}
                  alt=""
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-200">{item.title}</p>
                <p className="truncate text-xs text-zinc-500">{item.url}</p>
                {item.error && <p className="mt-1 text-xs text-red-400">{item.error}</p>}
              </div>
              {item.status === "pending" && (
                <button
                  type="button"
                  onClick={() => removePending(item.videoId)}
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {item.status === "adding" && (
                <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
              )}
              {item.status === "done" && (
                <span className="text-xs text-emerald-400">Añadido</span>
              )}
            </div>
          ))}

          <Button
            onClick={() => void addAll()}
            disabled={isAdding || pendingCount === 0}
            className="w-full"
          >
            {isAdding
              ? "Añadiendo..."
              : `Analizar ${pendingCount} video(s) de YouTube`}
          </Button>
        </div>
      )}
    </div>
  );
}
