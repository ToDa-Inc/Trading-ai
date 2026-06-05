"use client";

import { useState } from "react";
import { VideoUploader } from "@/components/video-uploader";
import { VideoList } from "@/components/video-list";

export default function VideosPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Tus videos de estrategia</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Sube videos donde explicas tu técnica. La IA los analizará para crear tu perfil de trading.
        </p>
      </div>

      <VideoUploader onUploadComplete={() => setRefreshKey((k) => k + 1)} />
      <VideoList key={refreshKey} />
    </div>
  );
}
