"use client";

import { useState } from "react";
import { MapPin, ShieldCheck, UserX } from "lucide-react";

const CHIPS = [
  { icon: UserX, text: "No account" },
  { icon: MapPin, text: "1–3 km fuzz" },
  { icon: ShieldCheck, text: "Nothing stored" },
];

// The first screen: the globe spins behind frosted glass until you drop in.
export default function EntryOverlay({
  onReady,
}: {
  onReady: (lat: number, lng: number) => Promise<void>;
}) {
  const [status, setStatus] = useState<"idle" | "locating" | "error">("idle");
  const [error, setError] = useState("");

  function enter() {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setError("Your browser doesn't support location access.");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        onReady(pos.coords.latitude, pos.coords.longitude).catch(() => {
          setStatus("error");
          setError("Couldn't join right now. Please try again in a moment.");
        }),
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Pulse needs your location to place you on the globe — it's fuzzed by 1–3 km before it leaves your device."
            : "Couldn't find your location. Please try again.",
        );
      },
      // High accuracy + maximumAge:0 forces a fresh fix (Wi-Fi/GPS scan)
      // instead of reusing the browser's cached IP-based location.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-linear-to-b from-space/30 via-space/20 to-space/85 p-5">
      <div className="glass rise-in w-full max-w-md rounded-4xl px-7 py-9 text-center">
        <p className="text-[11px] uppercase tracking-[0.35em] text-muted">
          a living globe of strangers
        </p>
        <h1 className="mt-3 font-display text-7xl leading-none text-ink">Pulse</h1>
        <p className="mx-auto mt-4 max-w-xs text-balance text-muted">
          Everyone awake right now is a light on the globe. Tap one and say
          hello.
        </p>
        <ul className="mt-6 flex flex-wrap justify-center gap-2">
          {CHIPS.map(({ icon: Icon, text }) => (
            <li
              key={text}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-ink/85"
            >
              <Icon className="h-3.5 w-3.5 text-glow" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
        <button
          onClick={enter}
          disabled={status === "locating"}
          className="btn-ember mt-8 w-full py-3.5 text-base"
        >
          {status === "locating" ? (
            <>
              <span className="locating-ring" aria-hidden /> Finding you…
            </>
          ) : (
            "Drop in"
          )}
        </button>
        {status === "error" && (
          <p role="alert" className="mt-4 text-sm text-danger">
            {error}
          </p>
        )}
        <p className="mt-6 text-xs text-muted">
          Chat and video go straight between browsers — never through our
          servers.
        </p>
      </div>
    </div>
  );
}
