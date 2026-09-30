"use client";

import { useEffect, useRef, useState } from "react";
import { PhoneOff, SendHorizontal, ShieldBan, Video } from "lucide-react";
import { MAX_CHAT_LENGTH } from "@/lib/webrtc";
import { useNow } from "@/lib/use-now";
import type { PeerDot } from "@/lib/types";
import { localTime } from "@/lib/localtime";
import { skyAt } from "@/lib/sky";
import SkyIcon from "./SkyIcon";

export interface ChatMessage {
  id: number;
  mine: boolean;
  text: string;
  at: number;
}

const clock = (at: number) =>
  new Date(at)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(/\s/g, " ");

// The conversation: a side sheet on desktop, a bottom sheet on phones
// (shorter while video is on, so both fit).
export default function ChatSheet({
  messages,
  connected,
  peer,
  videoActive,
  videoNotice,
  videoBusy,
  onSend,
  onStartVideo,
  onEnd,
  onSkip,
}: {
  messages: ChatMessage[];
  connected: boolean;
  peer: PeerDot | undefined;
  videoActive: boolean;
  videoNotice: string | null;
  videoBusy: boolean;
  onSend: (text: string) => void;
  onStartVideo: () => void;
  onEnd: () => void;
  onSkip: () => void;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const now = useNow();
  const sky = peer ? skyAt(peer.lat, peer.lng, now) : null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    onSend(text);
    setDraft("");
  }

  return (
    <aside
      className={`glass rise-in absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-3xl md:inset-y-4 md:left-auto md:right-4 md:h-auto md:w-[26rem] md:rounded-3xl ${
        videoActive ? "h-[42vh]" : "h-[62vh]"
      }`}
      aria-label="Chat with stranger"
    >
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-2xl leading-none text-ink">Stranger</p>
          <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted">
            {sky && peer && (
              <>
                <SkyIcon sky={sky} className="h-3.5 w-3.5 text-glow" />
                {localTime(peer.lat, peer.lng, now).text} · {sky} ·{" "}
              </>
            )}
            <span className={connected ? "text-glow" : ""}>
              {connected ? "Connected" : "Connecting…"}
            </span>
          </p>
        </div>
        <button
          onClick={onStartVideo}
          disabled={!connected || videoBusy}
          className="icon-btn"
          aria-label="Start video"
          title="Start video"
        >
          <Video className="h-4 w-4" aria-hidden />
        </button>
        <button
          onClick={onSkip}
          className="icon-btn"
          aria-label="Skip and block"
          title="Skip and block — you won't see them again this visit"
        >
          <ShieldBan className="h-4 w-4" aria-hidden />
        </button>
        <button onClick={onEnd} className="icon-btn is-danger" aria-label="End chat" title="End chat">
          <PhoneOff className="h-4 w-4" aria-hidden />
        </button>
      </header>

      {videoNotice && (
        <p className="border-b border-white/10 px-4 py-2 text-xs text-glow">
          {videoNotice}
        </p>
      )}

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="mx-auto mt-6 max-w-[16rem] text-center text-sm text-muted">
            Say hello. Messages go straight to them — peer-to-peer, never
            stored.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm [overflow-wrap:anywhere] whitespace-pre-wrap ${
                m.mine
                  ? "rounded-br-md bg-ember text-space"
                  : "rounded-bl-md bg-white/10 text-ink"
              }`}
            >
              <span>{m.text}</span>
              <span className={`mt-0.5 block text-[10px] ${m.mine ? "text-space/60" : "text-muted"}`}>
                {clock(m.at)}
              </span>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={submit}
        className="flex gap-2 border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_CHAT_LENGTH}
          placeholder={connected ? "Type a message…" : "Connecting…"}
          disabled={!connected}
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-glow/60 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!connected || !draft.trim()}
          className="btn-ember h-11 w-11 p-0"
          aria-label="Send"
        >
          <SendHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </aside>
  );
}
