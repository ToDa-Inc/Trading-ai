"use client";

import { useEffect, useRef, useState } from "react";
import { Send, ImagePlus, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { MessageContent } from "@/components/message-content";
import { ChatMessageImage } from "@/components/chat-message-image";
import type { ChatMessage } from "@/types/database";

interface ChatInterfaceProps {
  sessionId: string | null;
  onSessionCreated: (id: string) => void;
}

type DisplayMessage = ChatMessage & { localImageUrl?: string | null };

export function ChatInterface({ sessionId, onSessionCreated }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
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
      .then(({ data }) => setMessages((data as DisplayMessage[]) || []));
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

    const previewForMessage = imagePreview;
    const userContent = input.trim() || "Evalúa esta operación según mi estrategia.";

    try {
      const formData = new FormData();
      formData.append("message", userContent);
      if (sessionId) formData.append("sessionId", sessionId);
      if (image) formData.append("image", image);

      const userMsg: DisplayMessage = {
        id: crypto.randomUUID(),
        session_id: sessionId || "",
        user_id: "",
        role: "user",
        content: userContent,
        image_path: image ? "pending" : null,
        localImageUrl: previewForMessage,
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
            } else if (data.type === "error") {
              throw new Error(data.error);
            }
          }
        }
      }

      const assistantMsg: DisplayMessage = {
        id: crypto.randomUUID(),
        session_id: newSessionId || "",
        user_id: "",
        role: "assistant",
        content: fullText,
        image_path: null,
        citations: [],
        created_at: new Date().toISOString(),
      };

      setStreamingText("");
      setMessages((prev) => [...prev, assistantMsg]);

      if (newSessionId) {
        const supabase = createClient();
        const { data } = await supabase
          .from("chat_messages")
          .select("*")
          .eq("session_id", newSessionId)
          .order("created_at", { ascending: true });
        if (data) setMessages(data as DisplayMessage[]);
      }
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

        <div className="mx-auto max-w-3xl space-y-5">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[88%] rounded-2xl px-4 py-3 ${
                  msg.role === "user"
                    ? "bg-emerald-600/15 ring-1 ring-emerald-500/20"
                    : "bg-zinc-800/90 ring-1 ring-zinc-700/50"
                }`}
              >
                {(msg.image_path || msg.localImageUrl) && (
                  <ChatMessageImage
                    storagePath={msg.image_path || ""}
                    localUrl={msg.localImageUrl}
                  />
                )}
                {msg.role === "assistant" ? (
                  <MessageContent content={msg.content} />
                ) : (
                  msg.content && msg.content !== "Evalúa esta operación según mi estrategia." && (
                    <p className="text-sm leading-relaxed text-zinc-100">{msg.content}</p>
                  )
                )}
              </div>
            </div>
          ))}

          {streamingText && (
            <div className="flex justify-start">
              <div className="max-w-[88%] rounded-2xl bg-zinc-800/90 px-4 py-3 ring-1 ring-zinc-700/50">
                <MessageContent content={streamingText} />
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-emerald-400" />
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
              <img
                src={imagePreview}
                alt="Vista previa"
                className="max-h-28 rounded-lg border border-zinc-700 object-contain"
              />
              <button
                onClick={() => {
                  setImage(null);
                  setImagePreview(null);
                }}
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
