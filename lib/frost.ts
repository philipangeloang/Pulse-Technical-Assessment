// Soft Reveal. The camera is never sent to the peer directly: each frame is
// drawn onto a canvas — frosted until the user reveals themselves — and the
// canvas stream is what the peer receives. So no clear frame can leave the
// device before "Reveal me", whatever the other side's client does.
//
// Frames are drawn on requestAnimationFrame, which browsers pause in hidden
// tabs: if you switch away, your outgoing video freezes (fails private).

const MAX_WIDTH = 640;
const REVEAL_MS = 600;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

// Output size: the camera's aspect ratio, at most 640 px wide.
export function frostSize(width: number, height: number): { width: number; height: number } {
  const w = width > 0 ? width : 640;
  const h = height > 0 ? height : 480;
  const scale = Math.min(1, MAX_WIDTH / w);
  return { width: even(w * scale), height: even(h * scale) };
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return [canvas, ctx];
}

export class FrostedCamera {
  // Canvas video + the original audio: this is what gets sent.
  readonly stream: MediaStream;

  private readonly video: HTMLVideoElement;
  private readonly out: HTMLCanvasElement;
  private readonly outCtx: CanvasRenderingContext2D;
  private readonly small: HTMLCanvasElement;
  private readonly smallCtx: CanvasRenderingContext2D;
  private readonly tiny: HTMLCanvasElement;
  private readonly tinyCtx: CanvasRenderingContext2D;
  private target = 0; // 0 = frosted, 1 = revealed
  private amount = 0; // eased toward target for a soft cross-fade
  private last = 0;
  private raf = 0;
  private stopped = false;

  constructor(private readonly camera: MediaStream) {
    const settings = camera.getVideoTracks()[0]?.getSettings() ?? {};
    const size = frostSize(settings.width ?? 0, settings.height ?? 0);
    [this.out, this.outCtx] = makeCanvas(size.width, size.height);
    [this.small, this.smallCtx] = makeCanvas(128, even((128 * size.height) / size.width));
    [this.tiny, this.tinyCtx] = makeCanvas(32, even((32 * size.height) / size.width));

    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = camera;
    void this.video.play().catch(() => {});

    this.stream = new MediaStream([
      ...this.out.captureStream(30).getVideoTracks(),
      ...camera.getAudioTracks(),
    ]);
    this.raf = requestAnimationFrame(this.frame);
  }

  get revealed(): boolean {
    return this.target === 1;
  }

  setRevealed(revealed: boolean): void {
    this.target = revealed ? 1 : 0;
  }

  setMicMuted(muted: boolean): void {
    for (const track of this.camera.getAudioTracks()) track.enabled = !muted;
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    for (const track of this.stream.getTracks()) track.stop();
    for (const track of this.camera.getTracks()) track.stop();
    this.video.srcObject = null;
  }

  private frame = (now: number) => {
    if (this.stopped) return;
    const step = (this.last ? now - this.last : 16) / REVEAL_MS;
    this.last = now;
    this.amount =
      this.target > this.amount
        ? Math.min(this.target, this.amount + step)
        : Math.max(this.target, this.amount - step);
    if (this.video.readyState >= 2) this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw() {
    const { width, height } = this.out;
    const ctx = this.outCtx;
    if (this.amount < 1) {
      // Frost: shrink the frame to a few dozen pixels (all detail gone), then
      // scale it back up smoothly — a soft, frosted-glass silhouette.
      this.smallCtx.drawImage(this.video, 0, 0, this.small.width, this.small.height);
      this.tinyCtx.drawImage(this.small, 0, 0, this.tiny.width, this.tiny.height);
      this.smallCtx.drawImage(this.tiny, 0, 0, this.small.width, this.small.height);
      ctx.globalAlpha = 1;
      ctx.drawImage(this.small, 0, 0, width, height);
      ctx.fillStyle = "rgba(214, 226, 255, 0.10)";
      ctx.fillRect(0, 0, width, height);
    }
    if (this.amount > 0) {
      ctx.globalAlpha = this.amount;
      ctx.drawImage(this.video, 0, 0, width, height);
      ctx.globalAlpha = 1;
    }
  }
}
