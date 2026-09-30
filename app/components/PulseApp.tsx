"use client";

import { useEffect, useRef, useState } from "react";
import EntryOverlay from "./EntryOverlay";
import Hud from "./Hud";
import DotCard from "./DotCard";
import IncomingCall from "./IncomingCall";
import { Video } from "lucide-react";
import WorldMap, { type MePosition } from "./WorldMap";
import ConnectionPrompt from "./ConnectionPrompt";
import ChatPanel, { type ChatMessage } from "./ChatPanel";
import VideoPanel from "./VideoPanel";
import Toasts, { type Toast } from "./Toasts";
import {
  join,
  leave,
  poll,
  sendSignal,
  SessionExpiredError,
  type Session,
} from "@/lib/api";
import { PeerSession, type DescType, type PeerControl } from "@/lib/webrtc";
import { POLL_INTERVAL_MS, REQUEST_TIMEOUT_MS } from "@/lib/presence";
import { loadTimeZones } from "@/lib/localtime";
import { type PeerDot, type SignalMsg, type SignalType } from "@/lib/types";

type Conn =
  | { kind: "idle" }
  | { kind: "requesting"; peerId: string }
  | { kind: "incoming"; peerId: string }
  | { kind: "connecting"; peerId: string }
  | { kind: "connected"; peerId: string };

type VideoState = "none" | "requesting" | "incoming" | "active";

// Accepted but the peer-to-peer link never came up (e.g. blocked by a strict
// NAT — we're STUN-only). Give up instead of spinning on "Connecting…".
const CONNECT_TIMEOUT_MS = 25_000;

export default function PulseApp() {
  const [phase, setPhase] = useState<"gate" | "live">("gate");
  const [session, _setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(session);
  const setSession = (s: Session) => {
    sessionRef.current = s;
    _setSession(s);
  };
  const [peers, setPeers] = useState<PeerDot[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [me, setMe] = useState<MePosition | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const pollFailures = useRef(0);

  const [conn, _setConn] = useState<Conn>({ kind: "idle" });
  const connRef = useRef<Conn>(conn);
  const setConn = (c: Conn) => {
    connRef.current = c;
    _setConn(c);
  };

  const [video, _setVideo] = useState<VideoState>("none");
  const videoRef = useRef<VideoState>(video);
  const setVideo = (v: VideoState) => {
    videoRef.current = v;
    _setVideo(v);
  };

  const peerRef = useRef<PeerSession | null>(null);
  const msgId = useRef(0);
  // Times out whichever wait is in progress: an unanswered request, or an
  // accepted connection whose WebRTC link never opens.
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Send a signal as the current session. Resolves false if it was refused.
  function signal(
    toId: string,
    type: SignalType,
    payload?: string,
  ): Promise<boolean> {
    const s = sessionRef.current;
    return s ? sendSignal(s, toId, type, payload) : Promise.resolve(false);
  }

  function showNotice(text: string) {
    const id = toastId.current++;
    setToasts((prev) => [...prev.slice(-2), { id, text }]);
    window.setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      4000,
    );
  }

  function addMessage(mine: boolean, text: string) {
    setMessages((prev) => [...prev, { id: msgId.current++, mine, text }]);
  }

  function teardown(message?: string) {
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    peerRef.current?.close();
    peerRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
    setMessages([]);
    setConn({ kind: "idle" });
    if (message) showNotice(message);
  }

  function startPeer(peerId: string, initiator: boolean) {
    // Tell the peer (and the server, which frees both of us) before tearing
    // down locally — otherwise we'd both stay marked busy.
    const abandon = (message: string) => {
      void signal(peerId, "end");
      teardown(message);
    };
    const ps = new PeerSession(initiator, {
      onSignal: (type: DescType, payload: string) => {
        void signal(peerId, type, payload);
      },
      onChat: (text) => addMessage(false, text),
      onControl: (ctrl) => handleControl(ctrl),
      onRemoteStream: (stream) => setRemoteStream(stream),
      onConnectionState: (state) => {
        if (state === "failed" && peerRef.current === ps) {
          abandon("Connection failed (network).");
        }
      },
      onChannelOpen: () => {
        if (pendingTimer.current) clearTimeout(pendingTimer.current);
        setConn({ kind: "connected", peerId });
      },
    });
    peerRef.current = ps;
    pendingTimer.current = setTimeout(() => {
      const c = connRef.current;
      if (c.kind === "connecting" && c.peerId === peerId) {
        abandon("Couldn't reach the stranger. Try someone else?");
      }
    }, CONNECT_TIMEOUT_MS);
  }

  function handleControl(ctrl: PeerControl) {
    const ps = peerRef.current;
    switch (ctrl) {
      case "video-request":
        if (videoRef.current === "none") setVideo("incoming");
        break;
      case "video-accept":
        if (videoRef.current === "requesting" && ps) {
          ps.startVideo()
            .then((stream) => {
              setLocalStream(stream);
              setVideo("active");
            })
            .catch(() => {
              setVideo("none");
              ps.sendControl("video-end");
              showNotice("Camera unavailable.");
            });
        }
        break;
      case "video-decline":
        if (videoRef.current === "requesting") {
          setVideo("none");
          showNotice("Video declined.");
        }
        break;
      case "video-end":
        ps?.stopVideo();
        setLocalStream(null);
        setRemoteStream(null);
        setVideo("none");
        break;
    }
  }

  function requestConnection(peerId: string) {
    if (connRef.current.kind !== "idle") return;
    setConn({ kind: "requesting", peerId });
    void signal(peerId, "request").then((ok) => {
      const c = connRef.current;
      if (!ok && c.kind === "requesting" && c.peerId === peerId) {
        teardown("Couldn't send that request — try again in a moment.");
      }
    });
    pendingTimer.current = setTimeout(() => {
      if (
        connRef.current.kind === "requesting" &&
        connRef.current.peerId === peerId
      ) {
        void signal(peerId, "end");
        teardown("No answer.");
      }
    }, REQUEST_TIMEOUT_MS);
  }

  function cancelRequest() {
    if (connRef.current.kind === "requesting") {
      void signal(connRef.current.peerId, "end");
    }
    teardown();
  }

  function acceptIncoming() {
    if (connRef.current.kind !== "incoming") return;
    const peerId = connRef.current.peerId;
    startPeer(peerId, false);
    setConn({ kind: "connecting", peerId });
    setSelectedId(null);
    void signal(peerId, "accept").then((ok) => {
      // The request was withdrawn (cancelled, timed out, or they left) just
      // as we accepted.
      const c = connRef.current;
      if (!ok && c.kind === "connecting" && c.peerId === peerId) {
        teardown("That stranger is no longer available.");
      }
    });
  }

  function declineIncoming() {
    if (connRef.current.kind !== "incoming") return;
    void signal(connRef.current.peerId, "decline");
    setConn({ kind: "idle" });
  }

  function endConnection() {
    const c = connRef.current;
    if (c.kind === "connecting" || c.kind === "connected") {
      void signal(c.peerId, "end");
    }
    teardown();
  }

  function startVideoRequest() {
    if (videoRef.current !== "none" || !peerRef.current) return;
    setVideo("requesting");
    peerRef.current.sendControl("video-request");
  }

  function acceptVideo() {
    const ps = peerRef.current;
    if (!ps) return;
    ps.startVideo()
      .then((stream) => {
        setLocalStream(stream);
        ps.sendControl("video-accept");
        setVideo("active");
      })
      .catch(() => {
        ps.sendControl("video-decline");
        setVideo("none");
        showNotice("Camera unavailable.");
      });
  }

  function declineVideo() {
    peerRef.current?.sendControl("video-decline");
    setVideo("none");
  }

  function endVideo() {
    const ps = peerRef.current;
    ps?.stopVideo();
    ps?.sendControl("video-end");
    setLocalStream(null);
    setRemoteStream(null);
    setVideo("none");
  }

  function processSignal(sig: SignalMsg) {
    switch (sig.type) {
      case "request": {
        if (connRef.current.kind === "idle") {
          setConn({ kind: "incoming", peerId: sig.fromId });
        } else {
          void signal(sig.fromId, "decline");
        }
        break;
      }
      case "accept": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (pendingTimer.current) clearTimeout(pendingTimer.current);
          startPeer(sig.fromId, true);
          setConn({ kind: "connecting", peerId: sig.fromId });
          setSelectedId(null);
        }
        break;
      }
      case "decline": {
        const c = connRef.current;
        if (c.kind === "requesting" && c.peerId === sig.fromId) {
          if (pendingTimer.current) clearTimeout(pendingTimer.current);
          teardown("Request declined.");
        }
        break;
      }
      case "offer":
      case "answer":
      case "ice": {
        const c = connRef.current;
        const peerId =
          c.kind === "connecting" || c.kind === "connected" ? c.peerId : null;
        if (peerRef.current && peerId === sig.fromId) {
          void peerRef.current.handleSignal(
            sig.type as DescType,
            sig.payload ?? "",
          );
        }
        break;
      }
      case "end": {
        const c = connRef.current;
        if (
          (c.kind === "incoming" ||
            c.kind === "connecting" ||
            c.kind === "connected") &&
          c.peerId === sig.fromId
        ) {
          if (c.kind === "incoming") setConn({ kind: "idle" });
          else if (c.kind === "connecting")
            teardown("Couldn't connect to the stranger.");
          else teardown("Stranger disconnected.");
        }
        break;
      }
    }
  }

  // The server reaped us (tab frozen/backgrounded past STALE_MS, or restored
  // from bfcache after pagehide sent a leave). Come back as a *new* session:
  // a fresh id gets a fresh privacy offset that can't be linked to — and
  // averaged with — the old one to narrow down our real location.
  async function rejoin() {
    if (!me) return;
    if (connRef.current.kind !== "idle") {
      teardown("You were away too long, so the connection ended.");
    }
    const s = await join(me.real.lat, me.real.lng);
    setSession(s);
    setMe({ real: me.real, public: { lat: s.lat, lng: s.lng } });
  }

  const processSignalRef = useRef(processSignal);
  const rejoinRef = useRef(rejoin);
  useEffect(() => {
    processSignalRef.current = processSignal;
    rejoinRef.current = rejoin;
  });

  useEffect(() => {
    if (phase !== "live" || !session) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      let delay = POLL_INTERVAL_MS;
      try {
        const data = await poll(session);
        if (!active) return;
        setPeers(data.peers);
        pollFailures.current = 0;
        setReconnecting(false);
        for (const s of data.signals) processSignalRef.current(s);
      } catch (err) {
        if (!(err instanceof SessionExpiredError)) {
          pollFailures.current++;
          if (pollFailures.current >= 3) setReconnecting(true);
        }
        if (active && err instanceof SessionExpiredError) {
          try {
            // Re-joining swaps the session, which restarts this effect.
            await rejoinRef.current();
            return;
          } catch {
            delay = 5_000; // e.g. rate limited — back off before retrying
          }
        }
      }
      if (active) timer = setTimeout(tick, delay);
    };
    tick();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, session]);

  useEffect(() => {
    if (!session || phase !== "live") return;
    const onLeave = () => leave(session);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [session, phase]);

  async function handleReady(lat: number, lng: number) {
    const s = await join(lat, lng);
    setSession(s);
    setMe({ real: { lat, lng }, public: { lat: s.lat, lng: s.lng } });
    setPhase("live");
  }

  // Local times on the globe need the time-zone table; fetch it up front.
  useEffect(() => {
    void loadTimeZones();
  }, []);

  const inChat = conn.kind === "connecting" || conn.kind === "connected";
  const selectedPeer = peers.find((p) => p.id === selectedId);
  const requestingSelected =
    conn.kind === "requesting" && conn.peerId === selectedId;

  return (
    <main className="fixed inset-0 overflow-hidden bg-space">
      <WorldMap
        peers={peers}
        me={me}
        live={phase === "live"}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      {phase === "gate" ? (
        <EntryOverlay onReady={handleReady} />
      ) : (
        <Hud
          peers={peers}
          reconnecting={reconnecting}
          showHint={conn.kind === "idle" && !selectedPeer}
        />
      )}

      <Toasts toasts={toasts} />

      {selectedPeer && !inChat && (
        <DotCard
          peer={selectedPeer}
          from={me?.real ?? null}
          requesting={requestingSelected}
          canConnect={conn.kind === "idle"}
          onSayHi={() => requestConnection(selectedPeer.id)}
          onCancel={cancelRequest}
          onClose={() => {
            if (requestingSelected) cancelRequest();
            setSelectedId(null);
          }}
        />
      )}

      {conn.kind === "incoming" && (
        <IncomingCall
          peer={peers.find((p) => p.id === conn.peerId)}
          onAccept={acceptIncoming}
          onDecline={declineIncoming}
        />
      )}

      {inChat && (
        <ChatPanel
          messages={messages}
          connected={conn.kind === "connected"}
          videoBusy={video !== "none"}
          onSend={(text) => {
            peerRef.current?.sendChat(text);
            addMessage(true, text);
          }}
          onStartVideo={startVideoRequest}
          onEnd={endConnection}
        />
      )}

      {video === "requesting" && (
        <div className="glass absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full px-4 py-2 text-sm text-ink">
          Waiting for them to accept video…
        </div>
      )}

      {video === "incoming" && (
        <ConnectionPrompt
          icon={<Video className="h-6 w-6" aria-hidden />}
          title="Start a video call?"
          subtitle="The stranger would like to turn on video."
          acceptLabel="Accept"
          declineLabel="Not now"
          onAccept={acceptVideo}
          onDecline={declineVideo}
        />
      )}

      {video === "active" && (
        <VideoPanel
          localStream={localStream}
          remoteStream={remoteStream}
          onEnd={endVideo}
        />
      )}
    </main>
  );
}
