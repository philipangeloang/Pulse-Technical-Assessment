"use client";

import type { PeerDot } from "@/lib/types";
import { localTime } from "@/lib/localtime";
import { skyAt } from "@/lib/sky";
import ConnectionPrompt from "./ConnectionPrompt";
import { useNow } from "@/lib/use-now";
import SkyIcon from "./SkyIcon";

// "A stranger wants to talk" — with the one thing you know about them: what
// time it is, and what the sky looks like, where they are.
export default function IncomingCall({
  peer,
  onAccept,
  onDecline,
}: {
  peer: PeerDot | undefined;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const now = useNow();
  const sky = peer ? skyAt(peer.lat, peer.lng, now) : "night";
  const subtitle = peer
    ? `It's ${localTime(peer.lat, peer.lng, now).text} (${sky}) where they are.`
    : "Somewhere on the globe.";
  return (
    <ConnectionPrompt
      icon={<SkyIcon sky={sky} className="h-6 w-6" />}
      title="A stranger wants to talk"
      subtitle={subtitle}
      acceptLabel="Accept"
      declineLabel="Not now"
      onAccept={onAccept}
      onDecline={onDecline}
    />
  );
}
