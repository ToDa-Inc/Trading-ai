"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface ChatMessageImageProps {
  storagePath: string;
  localUrl?: string | null;
  alt?: string;
}

export function ChatMessageImage({ storagePath, localUrl, alt = "Captura adjunta" }: ChatMessageImageProps) {
  const [url, setUrl] = useState<string | null>(localUrl ?? null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (localUrl) {
      setUrl(localUrl);
      return;
    }

    if (!storagePath || storagePath === "pending") return;

    let active = true;
    const supabase = createClient();

    void supabase.storage
      .from("chat-uploads")
      .createSignedUrl(storagePath, 3600)
      .then(({ data, error: signError }) => {
        if (!active) return;
        if (signError || !data?.signedUrl) {
          setError(true);
          return;
        }
        setUrl(data.signedUrl);
      });

    return () => {
      active = false;
    };
  }, [storagePath, localUrl]);

  if (error || !url) return null;

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-zinc-700/60 bg-zinc-900/50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        className="max-h-64 w-auto max-w-full object-contain"
      />
    </div>
  );
}
