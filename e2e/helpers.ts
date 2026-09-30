import type { BrowserContext } from "@playwright/test";

// A fake client IP per browser context / API client, so per-IP rate limits
// don't bleed between tests. Only honoured locally: in production Vercel sets
// x-forwarded-for itself and client-supplied values are discarded.
export function randomClientIp(): string {
  const octet = () => Math.floor(Math.random() * 250) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

// Apply that fake IP to this context's calls to *our* API only. As a blanket
// extraHTTPHeaders it would also go to Mapbox, where a custom header forces a
// CORS preflight that Mapbox rejects — and the globe's tiles never load.
export async function useClientIp(
  context: BrowserContext,
  ip: string = randomClientIp(),
): Promise<void> {
  await context.route(
    (url) => url.pathname.startsWith("/api/"),
    (route) =>
      route.continue({
        headers: { ...route.request().headers(), "x-forwarded-for": ip },
      }),
  );
}
