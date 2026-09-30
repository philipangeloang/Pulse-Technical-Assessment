"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Compass, LocateFixed, Palette, Shuffle } from "lucide-react";
import { REGIONS, type Region, type RegionId } from "@/lib/regions";
import { THEMES, type ThemeId } from "@/lib/themes";

// A small dropdown: a glass pill button and a menu that closes on pick,
// Escape, or a click outside.
function Dropdown({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="glass flex items-center gap-2 rounded-full px-3.5 py-2 text-sm text-ink transition hover:brightness-125"
      >
        {icon}
        {label}
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="glass rise-in absolute left-0 top-full z-30 mt-2 w-64 rounded-2xl p-1.5"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const itemClass =
  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-ink transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

// Explore: jump to a region (with how many strangers are awake there), back
// to yourself, or to a random stranger who's free.
export function ExploreMenu({
  counts,
  canGoHome,
  canSurprise,
  onRegion,
  onHome,
  onSurprise,
}: {
  counts: Record<RegionId, number>;
  canGoHome: boolean;
  canSurprise: boolean;
  onRegion: (region: Region) => void;
  onHome: () => void;
  onSurprise: () => void;
}) {
  return (
    <Dropdown icon={<Compass className="h-4 w-4 text-glow" aria-hidden />} label="Explore">
      {(close) => (
        <>
          <button
            role="menuitem"
            className={itemClass}
            disabled={!canGoHome}
            onClick={() => {
              close();
              onHome();
            }}
          >
            <LocateFixed className="h-4 w-4 text-glow" aria-hidden />
            Back to me
          </button>
          <button
            role="menuitem"
            className={itemClass}
            disabled={!canSurprise}
            onClick={() => {
              close();
              onSurprise();
            }}
          >
            <Shuffle className="h-4 w-4 text-glow" aria-hidden />
            Surprise me
          </button>
          <p className="px-3 pb-1 pt-3 text-[10px] uppercase tracking-[0.25em] text-muted">
            Regions
          </p>
          {REGIONS.map((region) => {
            const n = counts[region.id];
            return (
              <button
                key={region.id}
                role="menuitem"
                className={`${itemClass} justify-between ${n === 0 ? "opacity-55" : ""}`}
                onClick={() => {
                  close();
                  onRegion(region);
                }}
              >
                <span>{region.label}</span>
                <span className={`text-xs ${n > 0 ? "text-glow" : "text-muted"}`}>
                  {n > 0 ? `${n} awake` : "no one yet"}
                </span>
              </button>
            );
          })}
        </>
      )}
    </Dropdown>
  );
}

// Theme: restyle the globe and the accents. Personal — only your view.
export function ThemeMenu({
  current,
  onPick,
}: {
  current: ThemeId;
  onPick: (id: ThemeId) => void;
}) {
  return (
    <Dropdown icon={<Palette className="h-4 w-4 text-glow" aria-hidden />} label="Theme">
      {(close) =>
        THEMES.map((theme) => (
          <button
            key={theme.id}
            role="menuitemradio"
            aria-checked={theme.id === current}
            className={itemClass}
            onClick={() => {
              close();
              onPick(theme.id);
            }}
          >
            <span className="flex shrink-0 -space-x-1.5" aria-hidden>
              <span
                className="h-5 w-5 rounded-full border border-white/20"
                style={{ background: theme.fog["space-color"] }}
              />
              <span
                className="h-5 w-5 rounded-full border border-white/20"
                style={{ background: theme.colors.ember }}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block">{theme.label}</span>
              <span className="block text-xs text-muted">{theme.description}</span>
            </span>
            {theme.id === current && <Check className="h-4 w-4 text-glow" aria-hidden />}
          </button>
        ))
      }
    </Dropdown>
  );
}
