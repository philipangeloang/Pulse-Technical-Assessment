import { useSyncExternalStore } from "react";

// The current time for rendering ("4:12 AM where they are"), as a React
// external store: stable within a 30 s bucket, re-read every 15 s.
const BUCKET_MS = 30_000;

const read = () => Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, BUCKET_MS / 2);
  return () => clearInterval(id);
}

export function useNow(): Date {
  return new Date(useSyncExternalStore(subscribe, read, read));
}
