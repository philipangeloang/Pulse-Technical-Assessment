import { connection } from "next/server";
import PulseApp from "./components/PulseApp";

export default async function Page() {
  // Render per request so proxy.ts can give every response a fresh CSP
  // nonce (a prerendered page has no request to take a nonce from).
  await connection();
  return <PulseApp />;
}
