"use client";

import { useCallback, useState } from "react";
import { Upload, X, FileVideo } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn, formatFileSize } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface UploadFile {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

interface VideoUploaderProps {
  onUploadComplete: () => void;
}

export function VideoUploader({ onUploadComplete }: VideoUploaderProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const videoFiles = Array.from(newFiles).filter((f) =>
      f.type.startsWith("video/") || /\.(mp4|webm|mov|avi|mpeg)$/i.test(f.name)
    );
    setFiles((prev) => [
      ...prev,
      ...videoFiles.map((file) => ({ file, progress: 0, status: "pending" as const })),
    ]);
  }, []);

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadAll = async () => {
    setIsUploading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (item.status === "done") continue;

      setFiles((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: "uploading", progress: 10 } : f))
      );

      try {
        const ext = item.file.name.split(".").pop() || "mp4";
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("trading-videos")
          .upload(path, item.file, {
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) throw uploadError;

        setFiles((prev) =>
          prev.map((f, idx) => (idx === i ? { ...f, progress: 70 } : f))
        );

        const { error: dbError } = await supabase.from("videos").insert({
          user_id: user.id,
          storage_path: path,
          filename: item.file.name,
        });

        if (dbError) throw dbError;

        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "done", progress: 100 } : f
          )
        );
      } catch (err) {
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? { ...f, status: "error", error: err instanceof Error ? err.message : "Error" }
              : f
          )
        );
      }
    }

    setIsUploading(false);
    onUploadComplete();
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-colors",
          isDragging
            ? "border-emerald-500 bg-emerald-500/5"
            : "border-zinc-700 bg-zinc-900/50 hover:border-zinc-600"
        )}
      >
        <Upload className="mb-4 h-10 w-10 text-zinc-500" />
        <p className="mb-2 text-sm font-medium text-zinc-300">
          Arrastra tus videos aquí o haz clic para seleccionar
        </p>
        <p className="mb-4 text-xs text-zinc-500">MP4, WebM, MOV — subida masiva soportada</p>
        <label>
          <input
            type="file"
            multiple
            accept="video/*"
            className="hidden"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <span className="cursor-pointer rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700">
            Seleccionar archivos
          </span>
        </label>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-3"
            >
              <FileVideo className="h-5 w-5 shrink-0 text-zinc-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-zinc-200">{item.file.name}</p>
                <p className="text-xs text-zinc-500">{formatFileSize(item.file.size)}</p>
                {item.status === "uploading" && (
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${item.progress}%` }}
                    />
                  </div>
                )}
                {item.error && <p className="mt-1 text-xs text-red-400">{item.error}</p>}
              </div>
              {item.status === "pending" && (
                <button onClick={() => removeFile(i)} className="text-zinc-500 hover:text-zinc-300">
                  <X className="h-4 w-4" />
                </button>
              )}
              {item.status === "done" && (
                <span className="text-xs text-emerald-400">Listo</span>
              )}
            </div>
          ))}

          <Button
            onClick={uploadAll}
            disabled={isUploading || files.every((f) => f.status === "done")}
            className="w-full"
          >
            {isUploading ? "Subiendo..." : `Subir ${files.filter((f) => f.status === "pending").length} video(s)`}
          </Button>
        </div>
      )}
    </div>
  );
}
