"use client";

import { useEffect, useRef, useState } from "react";
import { Send, ImagePlus, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import type { ChatMessage } from "@/types/database";

interface ChatInterfaceProps {
  sessionId: string | null;
  onSessionCreated: (id: string) => void;
}

export function ChatInterface({ sessionId, onSessionCreated }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }

    const supabase = createClient();
    supabase
      .from("chat_messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .then(({ data }) => setMessages((data as ChatMessage[]) || []));
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImage(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const sendMessage = async () => {
    if (!input.trim() && !image) return;
    setIsLoading(true);
    setStreamingText("");

    try {
      const formData = new FormData();
      formData.append("message", input.trim() || "Evalúa esta operación según mi estrategia.");
      if (sessionId) formData.append("sessionId", sessionId);
      if (image) formData.append("image", image);

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        session_id: sessionId || "",
        user_id: "",
        role: "user",
        content: input.trim() || "[Captura adjunta]",
        image_path: image ? "pending" : null,
        citations: [],
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setImage(null);
      setImagePreview(null);

      const res = await fetch("/api/chat", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Error en el chat");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";
      let newSessionId = sessionId;
      let citations: ChatMessage["citations"] = [];

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

          for (const line of lines) {
            const data = JSON.parse(line.slice(6));
            if (data.type === "session") {
              newSessionId = data.sessionId;
              onSessionCreated(data.sessionId);
            } else if (data.type === "token") {
              fullText += data.text;
              setStreamingText(fullText);
            } else if (data.type === "done") {
              citations = data.citations || [];
            } else if (data.type === "error") {
              throw new Error(data.error);
            }
          }
        }
      }

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        session_id: newSessionId || "",
        user_id: "",
        role: "assistant",
        content: fullText,
        image_path: null,
        citations,
        created_at: new Date().toISOString(),
      };

      setStreamingText("");
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          session_id: sessionId || "",
          user_id: "",
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "No se pudo obtener respuesta"}`,
          image_path: null,
          citations: [],
          created_at: new Date().toISOString(),
        },
      ]);
      setStreamingText("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 && !streamingText && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-lg font-medium text-zinc-300">Pregunta sobre tu estrategia</p>
            <p className="mt-2 max-w-md text-sm text-zinc-500">
              Haz preguntas sobre tus reglas de trading o adjunta capturas de operaciones
              para evaluar si cumplen tu estrategia.
            </p>
          </div>
        )}

        <div className="mx-auto max-w-3xl space-y-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-emerald-600/20 text-zinc-100"
                    : "bg-zinc-800/80 text-zinc-200"
                }`}
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                {msg.citations && msg.citations.length > 0 && (
                  <div className="mt-2 border-t border-zinc-700/50 pt-2">
                    <p className="text-xs text-zinc-500">Referencias:</p>
                    {msg.citations.map((c, i) => (
                      <p key={i} className="text-xs text-emerald-400/80">
                        Video {c.video_id.slice(0, 8)}...
                        {c.ts_start != null && ` @ ${Math.floor(c.ts_start / 60)}:${String(Math.floor(c.ts_start % 60)).padStart(2, "0")}`}
                        {c.topic && ` — ${c.topic}`}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {streamingText && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl bg-zinc-800/80 px-4 py-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                  {streamingText}
                  <span className="inline-block h-4 w-1 animate-pulse bg-emerald-400" />
                </p>
              </div>
            </div>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-800 bg-zinc-950 p-4">
        <div className="mx-auto max-w-3xl">
          {imagePreview && (
            <div className="mb-3 relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imagePreview} alt="Preview" className="h-20 rounded-lg border border-zinc-700" />
              <button
                onClick={() => { setImage(null); setImagePreview(null); }}
                className="absolute -right-2 -top-2 rounded-full bg-zinc-800 p-1 text-zinc-400 hover:text-zinc-200"
              >
                ×
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <label className="cursor-pointer rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">
              <ImagePlus className="h-5 w-5" />
              <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
            </label>

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!isLoading) sendMessage();
                }
              }}
              placeholder="Pregunta sobre tu estrategia o adjunta una captura..."
              rows={1}
              className="flex-1 resize-none rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />

            <Button onClick={sendMessage} disabled={isLoading || (!input.trim() && !image)} size="icon">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
