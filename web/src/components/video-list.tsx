"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Video } from "@/types/database";

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
    await supabase.storage.from("trading-videos").remove([video.storage_path]);
    await supabase.from("videos").delete().eq("id", video.id);
    fetchVideos();
  };

  if (loading) {
    return <div className="py-8 text-center text-zinc-500">Cargando videos...</div>;
  }

  if (videos.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 py-12 text-center">
        <p className="text-zinc-400">No hay videos subidos aún.</p>
        <p className="mt-1 text-sm text-zinc-500">Sube tus videos de estrategia para empezar.</p>
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
              <th className="px-4 py-3 font-medium">Archivo</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 font-medium w-16"></th>
            </tr>
          </thead>
          <tbody>
            {videos.map((video) => (
              <tr key={video.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
                <td className="px-4 py-3">
                  <p className="font-medium text-zinc-200">{video.filename}</p>
                  {video.error && (
                    <p className="mt-1 text-xs text-red-400">{video.error}</p>
                  )}
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
                  <button
                    onClick={() => deleteVideo(video)}
                    className="text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
