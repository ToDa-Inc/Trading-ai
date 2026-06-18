"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ExternalLink, FileVideo, PlayCircle, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { youtubeThumbnailUrl } from "@/lib/youtube";
import type { Video } from "@/types/database";

function VideoThumbnail({ video }: { video: Video }) {
  if (video.youtube_video_id) {
    return (
      <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded bg-zinc-800">
        <Image
          src={youtubeThumbnailUrl(video.youtube_video_id)}
          alt=""
          fill
          className="object-cover"
          unoptimized
        />
      </div>
    );
  }

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-zinc-800">
      <FileVideo className="h-5 w-5 text-zinc-500" />
    </div>
  );
}

export function VideoList() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchVideos = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("videos")
      .select("*")
      .order("created_at", { ascending: false });
    setVideos((data as Video[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const load = async () => {
      const { data } = await supabase
        .from("videos")
        .select("*")
        .order("created_at", { ascending: false });
      if (active) {
        setVideos((data as Video[]) || []);
        setLoading(false);
      }
    };

    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    const channel = supabase
      .channel("videos-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "videos" },
        () => { void load(); }
      )
      .subscribe();

    return () => {
      active = false;
      window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, []);

  const deleteVideo = async (video: Video) => {
    if (!confirm(`¿Eliminar "${video.filename}"?`)) return;
    const supabase = createClient();
    if (video.storage_path) {
      await supabase.storage.from("trading-videos").remove([video.storage_path]);
    }
    await supabase.from("videos").delete().eq("id", video.id);
    fetchVideos();
  };

  const retryVideo = async (video: Video) => {
    if (!video.youtube_url && !video.youtube_video_id) return;
    const res = await fetch(`/api/videos/${video.id}/process`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert((body as { error?: string }).error || "Error al reintentar");
      return;
    }
    fetchVideos();
  };

  if (loading) {
    return <div className="py-8 text-center text-zinc-500">Cargando videos...</div>;
  }

  if (videos.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 py-12 text-center">
        <p className="text-zinc-400">No hay videos aún.</p>
        <p className="mt-1 text-sm text-zinc-500">
          Sube archivos o añade URLs de YouTube para empezar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-zinc-200">
          Tus videos ({videos.length})
        </h2>
        <Button variant="ghost" size="sm" onClick={fetchVideos}>
          <RefreshCw className="h-4 w-4" />
          Actualizar
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/80 text-left text-zinc-400">
              <th className="px-4 py-3 font-medium">Video</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 font-medium w-16"></th>
            </tr>
          </thead>
          <tbody>
            {videos.map((video) => (
              <tr key={video.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <VideoThumbnail video={video} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {video.youtube_url && (
                          <PlayCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                        )}
                        <p className="truncate font-medium text-zinc-200">{video.filename}</p>
                      </div>
                      {video.youtube_url && (
                        <a
                          href={video.youtube_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 flex items-center gap-1 truncate text-xs text-zinc-500 hover:text-emerald-400"
                        >
                          Ver en YouTube
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      )}
                      {video.error && (
                        <p className="mt-1 text-xs text-red-400">{video.error}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={video.status} />
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {new Date(video.created_at).toLocaleDateString("es-ES", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {video.status === "error" && video.youtube_url && (
                      <button
                        onClick={() => retryVideo(video)}
                        className="text-zinc-500 hover:text-emerald-400"
                        title="Reintentar análisis"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => deleteVideo(video)}
                      className="text-zinc-500 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
