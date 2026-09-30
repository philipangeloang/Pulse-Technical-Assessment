"use client";

import { MessageCircle, X } from "lucide-react";
import type { PeerDot } from "@/lib/types";
import { localTime } from "@/lib/localtime";
import { skyAt } from "@/lib/sky";
import { describeDistance, distanceKm } from "@/lib/geo";
import { REQUEST_TIMEOUT_MS } from "@/lib/presence";
import { useNow } from "@/lib/use-now";
import SkyIcon from "./SkyIcon";

// The stranger you tapped: their local time and sky, how far away they are,
// and a deliberate "Say hi" (tapping a dot never sends a request by itself).
export default function DotCard({
  peer,
  from,
  requesting,
  canConnect,
  onSayHi,
  onCancel,
  onClose,
}: {
  peer: PeerDot;
  from: { lat: number; lng: number } | null;
  requesting: boolean;
  canConnect: boolean;
  onSayHi: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const now = useNow();
  const time = localTime(peer.lat, peer.lng, now);
  const sky = skyAt(peer.lat, peer.lng, now);

  return (
    <section
      role="region"
      aria-label="Selected stranger"
      className="glass rise-in absolute bottom-6 left-1/2 z-20 w-[min(92vw,22rem)] -translate-x-1/2 rounded-3xl p-5"
    >
      {requesting ? (
        <div className="flex items-center gap-4">
          <svg className="countdown h-12 w-12 shrink-0 -rotate-90" viewBox="0 0 40 40" aria-hidden>
            <circle cx="20" cy="20" r="18" fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="3" />
            <circle
              className="progress"
              cx="20"
              cy="20"
              r="18"
              fill="none"
              stroke="#ff8a5c"
              strokeWidth="3"
              strokeLinecap="round"
              style={{ animationDuration: `${REQUEST_TIMEOUT_MS}ms` }}
            />
          </svg>
          <div className="min-w-0 flex-1">
            <p className="font-display text-xl text-ink">Waiting for them…</p>
            <p className="text-sm text-muted">It&rsquo;s {time.text} where they are.</p>
          </div>
          <button onClick={onCancel} className="btn-ghost px-4 py-2 text-sm">
            Cancel
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-center gap-2 text-sm capitalize text-glow">
              <SkyIcon sky={sky} className="h-4 w-4" />
              {sky}
            </p>
            <button onClick={onClose} className="icon-btn h-8 w-8" aria-label="Close">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="mt-1 font-display text-5xl leading-none text-ink">
            {time.approximate ? "~" : ""}
            {time.text}
          </p>
          <p className="mt-2 text-sm text-muted">
            their local time
            {from ? ` · ${describeDistance(distanceKm(from, peer))}` : ""}
          </p>
          {peer.busy && (
            <p className="mt-3 text-sm text-ink/80">In a conversation right now.</p>
          )}
          <button
            onClick={onSayHi}
            disabled={!canConnect || peer.busy}
            className="btn-ember mt-5 w-full"
          >
            <MessageCircle className="h-4 w-4" aria-hidden />
            Say hi
          </button>
        </>
      )}
    </section>
  );
}
