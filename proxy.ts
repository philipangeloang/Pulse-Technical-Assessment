import { NextResponse, type NextRequest } from "next/server";

// Per-request Content Security Policy with a nonce, so only scripts Next.js
// itself emits (and what they load) can run. Next reads the nonce from the
// request's CSP header and stamps it on its own scripts during rendering.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    "default-src 'self'",
    // React needs eval in dev only (debug stack reconstruction).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // In dev, Next's devtools overlay injects <style> tags without a nonce.
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    // Mapbox: style/tiles/glyphs from its API, map tiles decoded in blob:
    // workers, sprites/markers as data:/blob: images. Its "map load"
    // events (used for billing) go to events.mapbox.com.
    "img-src 'self' data: blob: https://*.mapbox.com",
    "font-src 'self'",
    `connect-src 'self' https://*.mapbox.com${isDev ? " ws:" : ""}`,
    "worker-src 'self' blob:",
    "child-src blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Pages only: not API routes, static assets, or prefetches.
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
