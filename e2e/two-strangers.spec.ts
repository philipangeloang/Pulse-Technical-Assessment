import {
  test,
  expect,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "@playwright/test";
import { useClientIp } from "./helpers";

// The full Pulse happy path with two real browsers: both appear on the map,
// one taps the other, they chat over the WebRTC data channel, upgrade to
// video, hang up, and a closed tab disappears from the other user's map.

// Two Pacific islands ~1,140 km apart — far from where real users (who share
// the database in dev) are likely to be, so their dots never overlap ours.
const PAPEETE = { latitude: -17.5516, longitude: -149.5585 };
const AVARUA = { latitude: -21.2075, longitude: -159.7755 };

// The session id each page joined as (updated when it re-joins), read from
// its own /api/join response. Tests look up *that* stranger's dot, so they
// hold even when real people are online on the same database.
const sessionIds = new WeakMap<Page, string>();

function trackSession(page: Page) {
  page.on("response", async (res) => {
    if (res.url().endsWith("/api/join") && res.ok()) {
      try {
        sessionIds.set(page, (await res.json()).id);
      } catch {
        // page closed mid-read
      }
    }
  });
}

async function sessionId(page: Page): Promise<string> {
  await expect.poll(() => sessionIds.get(page)).toBeTruthy();
  return sessionIds.get(page)!;
}

// `target`'s dot as it appears on `viewer`'s map.
async function dotOf(viewer: Page, target: Page): Promise<Locator> {
  return viewer.locator(`.pulse-dot[data-peer-id="${await sessionId(target)}"]`);
}

// Tap a stranger's dot, then "Say hi" on their card.
async function sayHi(viewer: Page, target: Page) {
  await (await dotOf(viewer, target)).click();
  await viewer.getByRole("button", { name: "Say hi" }).click();
}

async function openStranger(
  browser: Browser,
  geolocation: { latitude: number; longitude: number },
  {
    unreachable = false,
    controllableClock = false,
    hostile = false,
    denyCamera = false,
    ...contextOptions
  }: {
    unreachable?: boolean;
    controllableClock?: boolean;
    hostile?: boolean;
    denyCamera?: boolean;
  } & BrowserContextOptions = {},
): Promise<Page> {
  const context = await browser.newContext({
    geolocation,
    permissions: ["geolocation", "camera", "microphone"],
    ...contextOptions,
  });
  await useClientIp(context);
  const page = await context.newPage();
  // Record Content-Security-Policy violations so tests can assert the
  // strict CSP doesn't break the map, video, or Next's own scripts.
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  // Fake timers that run in real time until paused — lets a test "freeze" the
  // tab the way a backgrounded or suspended browser does.
  if (controllableClock) await page.clock.install();
  if (hostile) {
    // Expose our own data channel so the test can bypass the app and send
    // raw messages, like a modified client would.
    await page.addInitScript(() => {
      const create = RTCPeerConnection.prototype.createDataChannel;
      RTCPeerConnection.prototype.createDataChannel = function (
        this: RTCPeerConnection,
        ...args: Parameters<typeof create>
      ) {
        const dc = create.apply(this, args);
        (window as unknown as { __dc: RTCDataChannel }).__dc = dc;
        return dc;
      };
    });
  }
  if (denyCamera) {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("denied", "NotAllowedError"));
    });
  }
  if (unreachable) {
    // Simulate a network where no ICE path works: drop all remote candidates.
    await page.addInitScript(() => {
      RTCPeerConnection.prototype.addIceCandidate = async () => {};
    });
  }
  trackSession(page);
  await page.goto("/");
  await page.getByRole("button", { name: /drop in/i }).click();
  return page;
}

type LatLng = { latitude: number; longitude: number };

// Great-circle distance (haversine).
function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

const remoteVideo = (page: Page) => page.locator("video[data-remote]");

// Edge detail (variance of the Laplacian) of the frame the receiver actually
// decoded — CSS blur doesn't affect drawImage, so this measures what was sent.
async function remoteSharpness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const v = document.querySelector("video[data-remote]") as HTMLVideoElement;
    const w = 160;
    const h = 120;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(v, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const g = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    };
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const lap = 4 * g(x, y) - g(x - 1, y) - g(x + 1, y) - g(x, y - 1) - g(x, y + 1);
        sum += lap;
        sum2 += lap * lap;
        n++;
      }
    }
    const mean = sum / n;
    return sum2 / n - mean * mean;
  });
}

async function startVideo(caller: Page, callee: Page) {
  await caller.getByRole("button", { name: "Start video" }).click();
  await expect(callee.getByText(/start a video call\?/i)).toBeVisible();
  await callee.getByRole("button", { name: "Accept" }).click();
  await expect.poll(() => remoteVideoIsPlaying(caller)).toBe(true);
  await expect.poll(() => remoteVideoIsPlaying(callee)).toBe(true);
}

async function remoteVideoIsPlaying(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const videos = [...document.querySelectorAll("video")];
    return videos.some((v) => {
      const stream = v.srcObject as MediaStream | null;
      return (
        !v.muted &&
        !!stream &&
        stream.getVideoTracks().length > 0 &&
        v.videoWidth > 0
      );
    });
  });
}

test("two strangers can find each other, chat, video call and leave", async ({
  browser,
}) => {
  const alice = await openStranger(browser, PAPEETE);
  const bob = await openStranger(browser, AVARUA);

  await test.step("each sees the other's dot", async () => {
    await expect(await dotOf(alice, bob)).toHaveCount(1);
    await expect(await dotOf(bob, alice)).toHaveCount(1);
  });

  await test.step("alice taps bob, bob accepts, both connect", async () => {
    await sayHi(alice, bob);
    await expect(bob.getByText(/wants to talk/i)).toBeVisible();
    await bob.getByRole("button", { name: "Accept" }).click();
    await expect(alice.getByText("Connected", { exact: true })).toBeVisible();
    await expect(bob.getByText("Connected", { exact: true })).toBeVisible();
  });

  await test.step("chat messages arrive in both directions", async () => {
    await alice.getByPlaceholder(/type a message/i).fill("hello from papeete");
    await alice.getByRole("button", { name: "Send" }).click();
    await expect(bob.getByText("hello from papeete")).toBeVisible();

    await bob.getByPlaceholder(/type a message/i).fill("hi from avarua");
    await bob.getByRole("button", { name: "Send" }).click();
    await expect(alice.getByText("hi from avarua")).toBeVisible();
  });

  await test.step("video call starts with remote video on both sides", async () => {
    await alice.getByRole("button", { name: "Start video" }).click();
    await expect(bob.getByText(/start a video call\?/i)).toBeVisible();
    await bob.getByRole("button", { name: "Accept" }).click();
    await expect.poll(() => remoteVideoIsPlaying(alice)).toBe(true);
    await expect.poll(() => remoteVideoIsPlaying(bob)).toBe(true);
  });

  await test.step("video starts frosted with the Soft Reveal controls", async () => {
    await expect(alice.getByRole("button", { name: "Reveal me" })).toBeVisible();
    await expect(bob.getByText(/they.re frosted/i)).toBeVisible();
  });

  await test.step("ending video returns both to chat", async () => {
    await alice.getByRole("button", { name: "End video" }).click();
    await expect(alice.getByPlaceholder(/type a message/i)).toBeVisible();
    await expect(bob.getByPlaceholder(/type a message/i)).toBeVisible();
  });

  await test.step("video can be restarted, from the other side", async () => {
    await expect(bob.getByRole("button", { name: "Start video" })).toBeEnabled();
    await bob.getByRole("button", { name: "Start video" }).click();
    await expect(alice.getByText(/start a video call\?/i)).toBeVisible();
    await alice.getByRole("button", { name: "Accept" }).click();
    await expect.poll(() => remoteVideoIsPlaying(alice)).toBe(true);
    await expect.poll(() => remoteVideoIsPlaying(bob)).toBe(true);
    await bob.getByRole("button", { name: "End video" }).click();
    await expect(alice.getByPlaceholder(/type a message/i)).toBeVisible();
  });

  await test.step("chat still works after video", async () => {
    await alice.getByPlaceholder(/type a message/i).fill("still here?");
    await alice.getByRole("button", { name: "Send" }).click();
    await expect(bob.getByText("still here?")).toBeVisible();
  });

  await test.step("the strict CSP blocked nothing along the way", async () => {
    expect(await cspViolations(alice)).toEqual([]);
    expect(await cspViolations(bob)).toEqual([]);
  });

  await test.step("hanging up frees both users", async () => {
    await bob.getByRole("button", { name: "End chat" }).click();
    await expect(alice.getByPlaceholder(/type a message/i)).toBeHidden();
    // Neither dot should stay dimmed as busy.
    await expect(await dotOf(alice, bob)).toHaveCSS("opacity", "1");
    await expect(await dotOf(bob, alice)).toHaveCSS("opacity", "1");
  });

  await test.step("they can connect a second time", async () => {
    await sayHi(bob, alice);
    await expect(alice.getByText(/wants to talk/i)).toBeVisible();
    await alice.getByRole("button", { name: "Accept" }).click();
    await expect(bob.getByText("Connected", { exact: true })).toBeVisible();
  });

  await test.step("closing a tab ends the chat and removes the dot", async () => {
    await bob.context().close();
    await expect(alice.getByPlaceholder(/type a message/i)).toBeHidden();
    await expect(await dotOf(alice, bob)).toHaveCount(0);
  });

  await alice.close({ runBeforeUnload: true });
});

test("a hostile peer can't flood or bloat the chat", async ({ browser }) => {
  const mallory = await openStranger(browser, PAPEETE, { hostile: true });
  const bob = await openStranger(browser, AVARUA);

  await sayHi(mallory, bob);
  await bob.getByRole("button", { name: "Accept" }).click();
  await expect(bob.getByText("Connected", { exact: true })).toBeVisible();

  await mallory.evaluate(() => {
    const dc = (window as unknown as { __dc: RTCDataChannel }).__dc;
    dc.send(JSON.stringify({ t: "chat", text: "x".repeat(5_000) }));
    for (let i = 0; i < 500; i++) {
      dc.send(JSON.stringify({ t: "chat", text: `spam ${i}` }));
    }
  });

  await expect(bob.getByText("spam 0", { exact: true })).toBeVisible();
  await bob.waitForTimeout(1_000);
  const shown = await bob.getByText(/^spam \d+$/).count();
  expect(shown).toBeLessThanOrEqual(20);
  await expect(bob.getByText("x".repeat(100))).toHaveCount(0);

  await mallory.close({ runBeforeUnload: true });
  await bob.close({ runBeforeUnload: true });
});

test("the raw location never leaves the browser", async ({ browser }) => {
  const context = await browser.newContext({
    geolocation: PAPEETE,
    permissions: ["geolocation"],
  });
  await useClientIp(context);
  const page = await context.newPage();
  await page.goto("/");
  const joinRequest = page.waitForRequest((r) => r.url().endsWith("/api/join"));
  await page.getByRole("button", { name: /drop in/i }).click();
  const sent = (await joinRequest).postDataJSON();

  const km = distanceKm(PAPEETE, { latitude: sent.lat, longitude: sent.lng });
  expect(km).toBeGreaterThan(0.95);
  expect(km).toBeLessThan(3.05);

  await page.close({ runBeforeUnload: true });
});

test("a tab frozen in the background comes back on the map", async ({
  browser,
}) => {
  const alice = await openStranger(browser, PAPEETE);
  const bob = await openStranger(browser, AVARUA, {
    controllableClock: true,
  });
  const firstId = await sessionId(bob);
  await expect(await dotOf(alice, bob)).toHaveCount(1);

  // Freeze bob's tab the way Chrome/mobile browsers do for background tabs:
  // no timers run, so no heartbeats, and the server reaps him.
  await bob.clock.pauseAt(Date.now() + 1000);
  await expect(await dotOf(alice, bob)).toHaveCount(0, { timeout: 30_000 });

  await bob.clock.resume();
  // He comes back as a new session (fresh id, fresh privacy offset).
  await expect.poll(() => sessionIds.get(bob)).not.toBe(firstId);
  await expect(await dotOf(alice, bob)).toHaveCount(1);
  await expect(await dotOf(bob, alice)).toHaveCount(1);

  // And he's reachable again, not just visible.
  await sayHi(alice, bob);
  await expect(bob.getByText(/wants to talk/i)).toBeVisible();

  await alice.close({ runBeforeUnload: true });
  await bob.close({ runBeforeUnload: true });
});

test("a connection that can't be established frees both users", async ({
  browser,
}) => {
  const alice = await openStranger(browser, PAPEETE, { unreachable: true });
  const bob = await openStranger(browser, AVARUA, { unreachable: true });

  await sayHi(alice, bob);
  await bob.getByRole("button", { name: "Accept" }).click();

  // Whichever side times out first gives up and tells the other; both get a
  // "couldn't reach / couldn't connect" notice rather than spinning forever.
  await Promise.all(
    [alice, bob].map((p) =>
      expect(p.getByText(/couldn't (reach|connect)/i)).toBeVisible({
        timeout: 40_000,
      }),
    ),
  );
  await expect(alice.getByText("Connecting…", { exact: true })).toBeHidden();
  await expect(bob.getByText("Connecting…", { exact: true })).toBeHidden();
  // Neither is left marked busy on the server.
  await expect(await dotOf(alice, bob)).toHaveCSS("opacity", "1");
  await expect(await dotOf(bob, alice)).toHaveCSS("opacity", "1");

  await alice.close({ runBeforeUnload: true });
  await bob.close({ runBeforeUnload: true });
});

test("the stranger card closes if they leave while it's open", async ({ browser }) => {
  const alice = await openStranger(browser, PAPEETE);
  const bob = await openStranger(browser, AVARUA);
  await (await dotOf(alice, bob)).click();
  const card = alice.getByRole("region", { name: "Selected stranger" });
  await expect(card).toBeVisible();
  await expect(card).toContainText(/\d{1,2}:\d{2} [AP]M/);
  await bob.close({ runBeforeUnload: true });
  await expect(card).toBeHidden();
  await alice.close({ runBeforeUnload: true });
});

test("the entry globe doesn't spin for reduced-motion users", async ({ browser }) => {
  const still = await browser.newContext({ reducedMotion: "reduce" });
  const moving = await browser.newContext();
  const a = await still.newPage();
  const b = await moving.newPage();
  await a.goto("/");
  await b.goto("/");
  await expect(b.locator("[data-spinning='true']")).toHaveCount(1);
  await expect(a.locator("[data-night-bands='4']")).toHaveCount(1);
  // Give a spin that shouldn't happen time to start before asserting.
  await a.waitForTimeout(1500);
  await expect(a.locator("[data-spinning='false']")).toHaveCount(1);
  await still.close();
  await moving.close();
});

test("skip & block hides the stranger and declines their requests", async ({ browser }) => {
  const alice = await openStranger(browser, PAPEETE);
  const bob = await openStranger(browser, AVARUA);
  await sayHi(alice, bob);
  await bob.getByRole("button", { name: "Accept" }).click();
  await expect(bob.getByText("Connected", { exact: true })).toBeVisible();

  await bob.getByRole("button", { name: "Skip and block" }).click();
  await expect(alice.getByText(/stranger disconnected/i)).toBeVisible();
  await expect(await dotOf(bob, alice)).toHaveCount(0);
  await expect(await dotOf(alice, bob)).toHaveCount(1);

  await sayHi(alice, bob);
  await expect(alice.getByText(/declined/i)).toBeVisible();
  await expect(bob.getByText(/wants to talk/i)).toBeHidden();

  await alice.close({ runBeforeUnload: true });
  await bob.close({ runBeforeUnload: true });
});

test("on a phone, long messages wrap and nothing scrolls sideways", async ({ browser }) => {
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const alice = await openStranger(browser, PAPEETE, phone);
  const bob = await openStranger(browser, AVARUA, phone);
  await sayHi(alice, bob);
  await bob.getByRole("button", { name: "Accept" }).click();
  await expect(alice.getByText("Connected", { exact: true })).toBeVisible();

  const long = "x".repeat(300);
  await alice.getByPlaceholder(/type a message/i).fill(long);
  await alice.getByRole("button", { name: "Send" }).click();
  await expect(bob.getByText(long)).toBeVisible();

  for (const page of [alice, bob]) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await page.getByText(long).boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  await alice.close({ runBeforeUnload: true });
  await bob.close({ runBeforeUnload: true });
});

test("soft reveal: frames stay frosted at the source until the sender reveals", async ({ browser }) => {
  const alice = await openStranger(browser, PAPEETE);
  const bob = await openStranger(browser, AVARUA);
  await sayHi(alice, bob);
  await bob.getByRole("button", { name: "Accept" }).click();
  await expect(alice.getByText("Connected", { exact: true })).toBeVisible();
  await startVideo(alice, bob);

  await bob.waitForTimeout(1500);
  const frosted = await remoteSharpness(bob);
  await expect(bob.getByText(/they.re frosted/i)).toBeVisible();
  await expect(bob.getByRole("button", { name: "Show them" })).toHaveCount(0);

  await alice.getByRole("button", { name: "Reveal me" }).click();
  // Bob is told — but still sees her blurred until he chooses to look.
  await expect(bob.getByRole("button", { name: "Show them" })).toBeVisible();
  await expect(remoteVideo(bob)).toHaveCSS("filter", /blur/);
  // The frames themselves are now clear.
  await expect
    .poll(() => remoteSharpness(bob), { timeout: 10_000 })
    .toBeGreaterThan(frosted * 4);

  const revealed = await remoteSharpness(bob);
  await bob.getByRole("button", { name: "Show them" }).click();
  await expect(remoteVideo(bob)).toHaveCSS("filter", "none");

  // Ending and restarting video starts frosted again, on both sides.
  await alice.getByRole("button", { name: "End video" }).click();
  await expect(bob.getByPlaceholder(/type a message/i)).toBeVisible();
  await startVideo(bob, alice);
  await expect(bob.getByText(/they.re frosted/i)).toBeVisible();
  await expect(remoteVideo(bob)).toHaveCSS("filter", /blur/);
  await bob.waitForTimeout(1500);
  // Measured: frosted ~2–5, revealed ~16–26 — the midpoint separates them.
  expect(await remoteSharpness(bob)).toBeLessThan((frosted + revealed) / 2);

  await alice.close({ runBeforeUnload: true });
  await bob.close({ runBeforeUnload: true });
});

test("a denied camera declines the video cleanly and keeps the chat", async ({ browser }) => {
  const alice = await openStranger(browser, PAPEETE);
  const bob = await openStranger(browser, AVARUA, { denyCamera: true });
  await sayHi(alice, bob);
  await bob.getByRole("button", { name: "Accept" }).click();
  await expect(alice.getByText("Connected", { exact: true })).toBeVisible();

  await alice.getByRole("button", { name: "Start video" }).click();
  await bob.getByRole("button", { name: "Accept" }).click();
  await expect(bob.getByText(/camera unavailable/i)).toBeVisible();
  await expect(alice.getByText(/video declined/i)).toBeVisible();
  await expect(alice.getByRole("button", { name: "Start video" })).toBeEnabled();
  await expect(bob.getByPlaceholder(/type a message/i)).toBeEnabled();

  await alice.close({ runBeforeUnload: true });
  await bob.close({ runBeforeUnload: true });
});

test("living globe: night is drawn and strangers show their local time and sky", async ({ browser }) => {
  const alice = await openStranger(browser, PAPEETE);
  const bob = await openStranger(browser, AVARUA);
  await expect(alice.locator("[data-night-bands='4']")).toHaveCount(1);
  // (Counts aren't exact: real people may be online on the same database.)
  await expect(alice.getByText(/\d+ strangers? awake · \d+ under the night sky/)).toBeVisible();
  await (await dotOf(alice, bob)).click();
  const card = alice.getByRole("region", { name: "Selected stranger" });
  await expect(card).toContainText(/\d{1,2}:\d{2} [AP]M/);
  await expect(card).toContainText(/night|before dawn|dawn|golden hour|daytime|dusk|late dusk/i);
  await expect(card).toContainText(/~1,100 km away/);
  await alice.close({ runBeforeUnload: true });
  await bob.close({ runBeforeUnload: true });
});
