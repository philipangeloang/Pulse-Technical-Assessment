import { FrostedCamera } from "@/lib/frost";

export type DescType = "offer" | "answer" | "ice";
export type PeerControl =
  | "video-request"
  | "video-accept"
  | "video-decline"
  | "video-end"
  | "reveal"
  | "frost";

interface PeerCallbacks {
  onSignal: (type: DescType, payload: string) => void;
  onChat: (text: string) => void;
  onControl: (ctrl: PeerControl) => void;
  onRemoteStream: (stream: MediaStream | null) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
  onChannelOpen: () => void;
}

const CONTROLS: readonly string[] = [
  "video-request",
  "video-accept",
  "video-decline",
  "video-end",
  "reveal",
  "frost",
];

export const MAX_CHAT_LENGTH = 1000;
const MAX_MESSAGE_BYTES = 4 * 1024;
const INBOUND_BURST = 20;
const INBOUND_WINDOW_MS = 5_000;
const MAX_QUEUED_CANDIDATES = 50;

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// The camera start was abandoned (call ended / video stopped meanwhile).
export class VideoCancelledError extends Error {}

export class PeerSession {
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private readonly polite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  private settingRemoteAnswer = false;
  private remoteTracks: MediaStreamTrack[] = [];
  private signalQueue: Promise<void> = Promise.resolve();
  private camera: FrostedCamera | null = null;
  private starting: Promise<MediaStream> | null = null;
  private videoEpoch = 0;
  private videoSenders: RTCRtpSender[] = [];
  private closed = false;
  private readonly cb: PeerCallbacks;
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(initiator: boolean, cb: PeerCallbacks) {
    this.cb = cb;
    this.polite = !initiator;
    this.pc = new RTCPeerConnection(ICE_CONFIG);

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.cb.onSignal("ice", JSON.stringify(candidate));
      }
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          this.cb.onSignal("offer", JSON.stringify(this.pc.localDescription));
        }
      } catch {
        // superseded (e.g. a remote offer arrived first) — negotiation retries
      } finally {
        this.makingOffer = false;
      }
    };

    // Build our own remote stream from the received tracks (one per kind).
    // The browser's own stream object (event.streams[0]) can have the tracks
    // pulled out of it again by a later description in a renegotiation
    // glare, which left the video element with an empty stream.
    this.pc.ontrack = ({ track }) => {
      const tracks = this.remoteTracks.filter((t) => t.kind !== track.kind);
      this.remoteTracks = [...tracks, track];
      this.cb.onRemoteStream(new MediaStream(this.remoteTracks));
    };

    this.pc.onconnectionstatechange = () => {
      this.cb.onConnectionState(this.pc.connectionState);
    };

    if (initiator) {
      this.dc = this.pc.createDataChannel("chat");
      this.wireDataChannel(this.dc);
    } else {
      this.pc.ondatachannel = (e) => {
        this.dc = e.channel;
        this.wireDataChannel(this.dc);
      };
    }
  }

  private wireDataChannel(dc: RTCDataChannel) {
    dc.onopen = () => this.cb.onChannelOpen();
    dc.onmessage = (e) => {
      // The other side is an anonymous stranger: accept only small, known
      // messages at a human pace, so a hostile peer can't freeze the tab.
      if (typeof e.data !== "string" || e.data.length > MAX_MESSAGE_BYTES) {
        return;
      }
      if (!this.inboundAllowed()) return;
      try {
        const msg = JSON.parse(e.data);
        if (
          msg.t === "chat" &&
          typeof msg.text === "string" &&
          msg.text.length <= MAX_CHAT_LENGTH
        ) {
          this.cb.onChat(msg.text);
        } else if (msg.t === "ctrl" && CONTROLS.includes(msg.ctrl)) {
          this.cb.onControl(msg.ctrl as PeerControl);
        }
      } catch {}
    };
  }

  // Sliding window: at most INBOUND_BURST messages per INBOUND_WINDOW_MS.
  private inbound: number[] = [];
  private inboundAllowed(): boolean {
    const now = Date.now();
    this.inbound = this.inbound.filter((t) => now - t < INBOUND_WINDOW_MS);
    if (this.inbound.length >= INBOUND_BURST) return false;
    this.inbound.push(now);
    return true;
  }

  // Signals come from a stranger (relayed by the server); anything malformed
  // or out of order is dropped instead of surfacing as an unhandled error.
  //
  // They're applied strictly one at a time, in arrival order. A poll often
  // delivers "answer, offer" together; handled concurrently, the offer was
  // judged while the answer was still being applied, mistaken for a
  // collision and ignored — and renegotiation ping-ponged forever (the
  // "Waiting for their camera…" hang when starting video again).
  handleSignal(type: DescType, payload: string): Promise<void> {
    const run = async () => {
      if (this.closed) return;
      try {
        await this.applySignal(type, JSON.parse(payload));
      } catch {}
    };
    this.signalQueue = this.signalQueue.then(run, run);
    return this.signalQueue;
  }

  private async applySignal(type: DescType, data: unknown) {
    if (type === "ice") {
      if (!this.pc.remoteDescription) {
        if (this.pendingCandidates.length < MAX_QUEUED_CANDIDATES) {
          this.pendingCandidates.push(data as RTCIceCandidateInit);
        }
        return;
      }
      try {
        await this.pc.addIceCandidate(data as RTCIceCandidateInit);
      } catch {}
      return;
    }

    // "Perfect negotiation": an offer collides only if we're mid-offer
    // ourselves (an answer we're applying counts as stable).
    const desc = data as RTCSessionDescriptionInit;
    const readyForOffer =
      !this.makingOffer &&
      (this.pc.signalingState === "stable" || this.settingRemoteAnswer);
    const offerCollision = desc.type === "offer" && !readyForOffer;
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;

    this.settingRemoteAnswer = desc.type === "answer";
    try {
      await this.pc.setRemoteDescription(desc);
    } finally {
      this.settingRemoteAnswer = false;
    }
    // Candidates can only be added once a remote description exists; drain
    // any that arrived early (including ones queued while the await above
    // was in flight — they typically land in the same poll batch).
    await this.flushPendingCandidates();
    if (desc.type === "offer") {
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) {
        this.cb.onSignal("answer", JSON.stringify(this.pc.localDescription));
      }
    }
  }

  private async flushPendingCandidates() {
    if (this.pendingCandidates.length === 0) return;
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {}
    }
  }

  sendChat(text: string) {
    this.safeSend({ t: "chat", text });
  }

  sendControl(ctrl: PeerControl) {
    this.safeSend({ t: "ctrl", ctrl });
  }

  private safeSend(obj: unknown) {
    if (this.dc && this.dc.readyState === "open") {
      this.dc.send(JSON.stringify(obj));
    }
  }

  // Soft Reveal: the peer receives the frosted canvas stream, never the
  // camera itself. Returns that stream (it doubles as the honest self-view).
  // Concurrent calls share one camera start. If the call ends or video is
  // stopped while the permission prompt is up, the camera is released and
  // this rejects with VideoCancelledError.
  startVideo(): Promise<MediaStream> {
    if (this.camera) return Promise.resolve(this.camera.stream);
    this.starting ??= this.openCamera().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async openCamera(): Promise<MediaStream> {
    const epoch = this.videoEpoch;
    const raw = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    if (this.closed || epoch !== this.videoEpoch) {
      for (const track of raw.getTracks()) track.stop();
      throw new VideoCancelledError();
    }
    let camera: FrostedCamera | null = null;
    try {
      camera = new FrostedCamera(raw);
      for (const track of camera.stream.getTracks()) {
        this.videoSenders.push(this.pc.addTrack(track, camera.stream));
      }
      this.camera = camera;
      return camera.stream;
    } catch (err) {
      if (camera) camera.stop();
      else for (const track of raw.getTracks()) track.stop();
      this.stopSenders();
      throw err;
    }
  }

  setRevealed(revealed: boolean) {
    if (!this.camera) return;
    this.camera.setRevealed(revealed);
    this.sendControl(revealed ? "reveal" : "frost");
  }

  setMicMuted(muted: boolean) {
    this.camera?.setMicMuted(muted);
  }

  stopVideo() {
    this.videoEpoch++; // cancels a camera start still in flight
    this.remoteTracks = [];
    if (!this.camera) return;
    this.camera.stop();
    this.camera = null;
    this.stopSenders();
  }

  // Stop (not just remove) our video transceivers: removeTrack leaves the
  // m-lines behind, so each video session grew the SDP until offers blew
  // past the server's size cap and the third session could never connect.
  private stopSenders() {
    for (const sender of this.videoSenders) {
      const transceiver = this.pc
        .getTransceivers()
        .find((t) => t.sender === sender);
      try {
        transceiver?.stop();
      } catch {}
    }
    this.videoSenders = [];
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopVideo();
    if (this.dc) {
      try {
        this.dc.close();
      } catch {}
    }
    try {
      this.pc.close();
    } catch {}
  }
}
