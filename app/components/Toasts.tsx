"use client";

import { Info } from "lucide-react";

export interface Toast {
  id: number;
  text: string;
}

// Transient notices ("Request declined.", "Stranger disconnected."), stacked
// at the top of the screen and announced to screen readers.
export default function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="glass rise-in flex items-center gap-2 rounded-full px-4 py-2 text-sm text-ink"
        >
          <Info className="h-4 w-4 shrink-0 text-glow" aria-hidden />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
