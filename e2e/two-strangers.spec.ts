import {
  test,
  expect,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { useClientIp } from "./helpers";

// The full Pulse happy path with two real browsers: both appear on the map,
// one taps the other, they chat over the WebRTC data channel, upgrade to
// video, hang up, and a closed tab disappears from the other user's map.

const MANILA = { latitude: 14.5995, longitude: 120.9842 };
const HONG_KONG = { latitude: 22.3193, longitude: 114.1694 };

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

async function openStranger(
  browser: Browser,
  geolocation: { latitude: number; longitude: number },
  { unreachable = false, controllableClock = false, hostile = false } = {},
): Promise<Page> {
  const context = await browser.newContext({
    geolocation,
    permissions: ["geolocation", "camera", "microphone"],
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
  if (unreachable) {
    // Simulate a network where no ICE path works: drop all remote candidates.
    await page.addInitScript(() => {
      RTCPeerConnection.prototype.addIceCandidate = async () => {};
    });
  }
  trackSession(page);
  await page.goto("/");
  await page.getByRole("button", { name: /enter pulse/i }).click();
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
  const alice = await openStranger(browser, MANILA);
  const bob = await openStranger(browser, HONG_KONG);

  await test.step("each sees the other's dot", async () => {
    await expect(await dotOf(alice, bob)).toHaveCount(1);
    await expect(await dotOf(bob, alice)).toHaveCount(1);
  });

  await test.step("alice taps bob, bob accepts, both connect", async () => {
    await (await dotOf(alice, bob)).click();
    await expect(bob.getByText(/wants to connect/i)).toBeVisible();
    await bob.getByRole("button", { name: "Accept" }).click();
    await expect(alice.getByText("Connected", { exact: true })).toBeVisible();
    await expect(bob.getByText("Connected", { exact: true })).toBeVisible();
  });

  await test.step("chat messages arrive in both directions", async () => {
    await alice.getByPlaceholder(/type a message/i).fill("hello from manila");
    await alice.getByRole("button", { name: "Send" }).click();
    await expect(bob.getByText("hello from manila")).toBeVisible();

    await bob.getByPlaceholder(/type a message/i).fill("hi from hong kong");
    await bob.getByRole("button", { name: "Send" }).click();
    await expect(alice.getByText("hi from hong kong")).toBeVisible();
  });

  await test.step("video call starts with remote video on both sides", async () => {
    await alice.getByRole("button", { name: "Video" }).click();
    await expect(bob.getByText(/start video call/i)).toBeVisible();
    await bob.getByRole("button", { name: "Accept" }).click();
    await expect.poll(() => remoteVideoIsPlaying(alice)).toBe(true);
    await expect.poll(() => remoteVideoIsPlaying(bob)).toBe(true);
  });

  await test.step("ending video returns both to chat", async () => {
    await alice.getByRole("button", { name: "End video" }).click();
    await expect(alice.getByPlaceholder(/type a message/i)).toBeVisible();
    await expect(bob.getByPlaceholder(/type a message/i)).toBeVisible();
  });

  await test.step("video can be restarted, from the other side", async () => {
    await expect(bob.getByRole("button", { name: "Video" })).toBeEnabled();
    await bob.getByRole("button", { name: "Video" }).click();
    await expect(alice.getByText(/start video call/i)).toBeVisible();
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
    await bob.getByRole("button", { name: "End", exact: true }).click();
    await expect(alice.getByPlaceholder(/type a message/i)).toBeHidden();
    // Neither dot should stay dimmed as busy.
    await expect(await dotOf(alice, bob)).toHaveCSS("opacity", "1");
    await expect(await dotOf(bob, alice)).toHaveCSS("opacity", "1");
  });

  await test.step("they can connect a second time", async () => {
    await (await dotOf(bob, alice)).click();
    await expect(alice.getByText(/wants to connect/i)).toBeVisible();
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
  const mallory = await openStranger(browser, MANILA, { hostile: true });
  const bob = await openStranger(browser, HONG_KONG);

  await (await dotOf(mallory, bob)).click();
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
    geolocation: MANILA,
    permissions: ["geolocation"],
  });
  await useClientIp(context);
  const page = await context.newPage();
  await page.goto("/");
  const joinRequest = page.waitForRequest((r) => r.url().endsWith("/api/join"));
  await page.getByRole("button", { name: /enter pulse/i }).click();
  const sent = (await joinRequest).postDataJSON();

  const km = distanceKm(MANILA, { latitude: sent.lat, longitude: sent.lng });
  expect(km).toBeGreaterThan(0.95);
  expect(km).toBeLessThan(3.05);

  await page.close({ runBeforeUnload: true });
});

test("a tab frozen in the background comes back on the map", async ({
  browser,
}) => {
  const alice = await openStranger(browser, MANILA);
  const bob = await openStranger(browser, HONG_KONG, {
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
  await (await dotOf(alice, bob)).click();
  await expect(bob.getByText(/wants to connect/i)).toBeVisible();

  await alice.close({ runBeforeUnload: true });
  await bob.close({ runBeforeUnload: true });
});

test("a connection that can't be established frees both users", async ({
  browser,
}) => {
  const alice = await openStranger(browser, MANILA, { unreachable: true });
  const bob = await openStranger(browser, HONG_KONG, { unreachable: true });

  await (await dotOf(alice, bob)).click();
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
