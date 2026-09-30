"use client";

import type { ReactNode } from "react";

// A centred glass prompt for "someone wants to talk" / "start video?".
export default function ConnectionPrompt({
  icon,
  title,
  subtitle,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  acceptLabel: string;
  declineLabel: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-space/55 p-6 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-title"
    >
      <div className="glass rise-in w-full max-w-sm rounded-3xl p-7 text-center">
        {icon && <div className="incoming-ring mx-auto">{icon}</div>}
        <h2 id="prompt-title" className="mt-5 font-display text-3xl leading-tight text-ink">
          {title}
        </h2>
        {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
        <div className="mt-7 flex gap-3">
          <button onClick={onDecline} className="btn-ghost flex-1">
            {declineLabel}
          </button>
          <button onClick={onAccept} className="btn-ember flex-1">
            {acceptLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
