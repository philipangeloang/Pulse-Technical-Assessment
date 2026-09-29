import type { NextConfig } from "next";

// Static security headers for every response (the per-request CSP with its
// nonce is set in proxy.ts).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Anonymity: never leak the page URL to Mapbox or anywhere else.
  { key: "Referrer-Policy", value: "no-referrer" },
  // Camera/mic/location only for Pulse itself, never for embedded content.
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(self), geolocation=(self), browsing-topics=()",
  },
  // Legacy clickjacking guard (CSP frame-ancestors covers modern browsers).
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
