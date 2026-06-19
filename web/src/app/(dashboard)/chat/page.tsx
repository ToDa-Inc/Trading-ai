"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ChatInterface } from "@/components/chat-interface";
import { MemoryReviewPanel } from "@/components/memory-review-panel";
import { Button } from "@/components/ui/button";
import type { ChatSession } from "@/types/database";

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);

  const fetchSessions = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("chat_sessions")
      .select("*")
      .order("updated_at", { ascending: false });
    setSessions((data as ChatSession[]) || []);
  };

  useEffect(() => {
    let active = true;

    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("chat_sessions")
        .select("*")
        .order("updated_at", { ascending: false });
      if (active) {
        setSessions((data as ChatSession[]) || []);
      }
    };

    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  const newChat = () => {
    setActiveSession(null);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-xl border border-zinc-800">
      <aside className="w-64 shrink-0 border-r border-zinc-800 bg-zinc-900/50">
        <div className="p-3">
          <Button variant="outline" size="sm" className="w-full" onClick={newChat}>
            <Plus className="h-4 w-4" />
            Nueva conversación
          </Button>
        </div>
        <div className="overflow-y-auto px-2 pb-4">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => setActiveSession(session.id)}
              className={`mb-1 w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                activeSession === session.id
                  ? "bg-zinc-800 text-emerald-400"
                  : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
              }`}
            >
              {session.title}
            </button>
          ))}
        </div>
      </aside>

      <div className="relative flex flex-1 flex-col">
        <div className="absolute right-3 top-3 z-10">
          <MemoryReviewPanel />
        </div>
        <ChatInterface
          sessionId={activeSession}
          onSessionCreated={(id) => {
            setActiveSession(id);
            fetchSessions();
          }}
        />
      </div>
    </div>
  );
}
