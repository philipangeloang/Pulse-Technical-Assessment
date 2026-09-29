// A fake client IP per browser context / API client, so per-IP rate limits
// don't bleed between tests. Only honoured locally: in production Vercel sets
// x-forwarded-for itself and client-supplied values are discarded.
export function randomClientIp(): string {
  const octet = () => Math.floor(Math.random() * 250) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}
