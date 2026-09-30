// The viewer's chosen theme, remembered in this browser only (localStorage).
// Storage can be unavailable (private windows, blocked site data), so an
// in-memory copy keeps switching working for the visit either way.
import { useSyncExternalStore } from "react";
import { DEFAULT_THEME, parseThemeId, type ThemeId } from "@/lib/themes";

const KEY = "pulse:theme";
const CHANGED = "pulse:theme-changed";
let memory: ThemeId | null = null;

function read(): ThemeId {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return parseThemeId(stored);
  } catch {
    // storage unavailable
  }
  return memory ?? DEFAULT_THEME;
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useThemeId(): ThemeId {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_THEME);
}

export function setThemeId(id: ThemeId): void {
  memory = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // storage unavailable — the in-memory copy still applies
  }
  window.dispatchEvent(new Event(CHANGED));
}
