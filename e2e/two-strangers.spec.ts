import { test, expect, type Browser, type Page } from "@playwright/test";

// The full Pulse happy path with two real browsers: both appear on the map,
// one taps the other, they chat over the WebRTC data channel, upgrade to
// video, hang up, and a closed tab disappears from the other user's map.

const MANILA = { latitude: 14.5995, longitude: 120.9842 };
const HONG_KONG = { latitude: 22.3193, longitude: 114.1694 };

async function openStranger(
  browser: Browser,
  geolocation: { latitude: number; longitude: number },
): Promise<Page> {
  const context = await browser.newContext({
    geolocation,
    permissions: ["geolocation", "camera", "microphone"],
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: /enter pulse/i }).click();
  return page;
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
    await expect(alice.locator(".pulse-dot")).toHaveCount(1);
    await expect(bob.locator(".pulse-dot")).toHaveCount(1);
  });

  await test.step("alice taps bob, bob accepts, both connect", async () => {
    await alice.locator(".pulse-dot").click();
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

  await test.step("hanging up frees both users", async () => {
    await bob.getByRole("button", { name: "End", exact: true }).click();
    await expect(alice.getByPlaceholder(/type a message/i)).toBeHidden();
    // Neither dot should stay dimmed as busy.
    await expect(alice.locator(".pulse-dot")).toHaveCSS("opacity", "1");
    await expect(bob.locator(".pulse-dot")).toHaveCSS("opacity", "1");
  });

  await test.step("they can connect a second time", async () => {
    await bob.locator(".pulse-dot").click();
    await expect(alice.getByText(/wants to connect/i)).toBeVisible();
    await alice.getByRole("button", { name: "Accept" }).click();
    await expect(bob.getByText("Connected", { exact: true })).toBeVisible();
  });

  await test.step("closing a tab ends the chat and removes the dot", async () => {
    await bob.context().close();
    await expect(alice.getByPlaceholder(/type a message/i)).toBeHidden();
    await expect(alice.locator(".pulse-dot")).toHaveCount(0);
  });

  await alice.context().close();
});
