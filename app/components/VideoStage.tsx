"use client";

import { useEffect, useRef } from "react";
import { Eye, Mic, MicOff, Snowflake, Sparkles, VideoOff } from "lucide-react";

// Soft Reveal video. Both people start frosted at the source. You decide
// when to reveal yourself, and — separately — when to look at them: their
// video stays blurred on your side until you tap "Show them", which is only
// offered once they've revealed.
export default function VideoStage({
  localStream,
  remoteStream,
  revealedMe,
  remoteRevealed,
  showRemote,
  micMuted,
  onToggleReveal,
  onShowRemote,
  onToggleMic,
  onEnd,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  revealedMe: boolean;
  remoteRevealed: boolean;
  showRemote: boolean;
  micMuted: boolean;
  onToggleReveal: () => void;
  onShowRemote: () => void;
  onToggleMic: () => void;
  onEnd: () => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <section
      className="absolute inset-x-0 top-0 bottom-[42vh] z-30 overflow-hidden bg-deep md:inset-y-0 md:left-0 md:right-[28rem] md:bottom-0"
      aria-label="Video call"
    >
      <video
        ref={remoteRef}
        data-remote
        autoPlay
        playsInline
        className={`h-full w-full object-cover transition-[filter,scale] duration-700 ${
          showRemote ? "" : "remote-frosted"
        }`}
      />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
        {!remoteStream ? (
          <p className="glass is-dark rounded-full px-4 py-2 text-sm text-ink">
            Waiting for their camera…
          </p>
        ) : !remoteRevealed ? (
          <p className="glass is-dark flex items-center gap-2 rounded-full px-4 py-2 text-sm text-ink">
            <Snowflake className="h-4 w-4 text-glow" aria-hidden />
            They&rsquo;re frosted — they&rsquo;ll reveal when they&rsquo;re ready.
          </p>
        ) : !showRemote ? (
          <div className="glass is-dark pointer-events-auto rise-in rounded-3xl p-5 text-center">
            <p className="font-display text-2xl text-ink">They revealed themselves</p>
            <p className="mt-1 text-sm text-muted">Look when you&rsquo;re ready.</p>
            <button onClick={onShowRemote} className="btn-ember mt-4">
              <Eye className="h-4 w-4" aria-hidden />
              Show them
            </button>
          </div>
        ) : null}
      </div>

      <figure className="glass is-dark absolute right-4 top-4 w-28 overflow-hidden rounded-2xl md:w-40">
        <video ref={localRef} autoPlay playsInline muted className="aspect-[3/4] w-full object-cover" />
        <figcaption className="px-2 py-1.5 text-center text-[11px] text-ink/85">
          {revealedMe ? "They can see you" : "You're frosted"}
        </figcaption>
      </figure>

      <div className="glass is-dark absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full p-2">
        <button
          onClick={onToggleReveal}
          className={revealedMe ? "btn-ghost px-4 py-2 text-sm" : "btn-ember px-4 py-2 text-sm"}
        >
          {revealedMe ? (
            <>
              <Snowflake className="h-4 w-4" aria-hidden /> Frost me
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" aria-hidden /> Reveal me
            </>
          )}
        </button>
        <button
          onClick={onToggleMic}
          className="icon-btn"
          aria-label={micMuted ? "Unmute" : "Mute"}
          title={micMuted ? "Unmute" : "Mute"}
        >
          {micMuted ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
        </button>
        <button onClick={onEnd} className="icon-btn is-danger" aria-label="End video" title="End video">
          <VideoOff className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
