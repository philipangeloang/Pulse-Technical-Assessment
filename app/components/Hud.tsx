"use client";

import type { PeerDot } from "@/lib/types";
import { isDark } from "@/lib/sky";
import { useNow } from "@/lib/use-now";

// Brand, a live head count (and how many are under the night sky), and a
// hint for what to do next.
export default function Hud({
  peers,
  reconnecting,
  showHint,
}: {
  peers: PeerDot[];
  reconnecting: boolean;
  showHint: boolean;
}) {
  const now = useNow();
  const n = peers.length;
  const underNight = peers.filter((p) => isDark(p.lat, p.lng, now)).length;
  const count =
    n === 0
      ? "No one else is here yet"
      : `${n} ${n === 1 ? "stranger" : "strangers"} awake · ${underNight} under the night sky`;

  return (
    <>
      <header className="pointer-events-none absolute left-4 top-4 z-20 max-w-[calc(100vw-2rem)]">
        <div className="glass rise-in flex items-center gap-3 rounded-2xl px-4 py-3">
          <span className="live-dot" aria-hidden />
          <div>
            <p className="font-display text-2xl leading-none text-ink">Pulse</p>
            <p className="mt-1 text-xs text-muted" aria-live="polite">
              {count}
            </p>
          </div>
        </div>
        {reconnecting && (
          <p className="glass mt-2 inline-block rounded-full px-3 py-1 text-xs text-glow">
            Reconnecting…
          </p>
        )}
      </header>
      {showHint && (
        <p className="glass rise-in pointer-events-none absolute bottom-8 left-1/2 z-10 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full px-4 py-2 text-center text-sm text-ink/85">
          {n === 0
            ? "It's quiet right now — open Pulse in a second window to meet yourself."
            : "Tap a glowing dot to say hello."}
        </p>
      )}
    </>
  );
}
