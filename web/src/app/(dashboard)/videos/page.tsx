"use client";

import { useState } from "react";
import { VideoUploader } from "@/components/video-uploader";
import { VideoList } from "@/components/video-list";
import { YoutubeUrlInput } from "@/components/youtube-url-input";

export default function VideosPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => setRefreshKey((k) => k + 1);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Tus videos de estrategia</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Sube archivos o enlaza videos de YouTube. La IA analizará audio y contenido visual
          para crear tu perfil de trading y memoria RAG.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <YoutubeUrlInput onAddComplete={handleRefresh} />
        <VideoUploader onUploadComplete={handleRefresh} />
      </div>

      <VideoList key={refreshKey} />
    </div>
  );
}
