// A place's local wall-clock time, e.g. "4:12 AM". Time zones come from an
// offline lookup loaded on demand; until it's loaded (or if it fails) we
// fall back to solar time from the longitude, flagged as approximate.

export interface LocalTime {
  text: string;
  approximate: boolean;
}

type Lookup = (lat: number, lng: number) => string;

let lookup: Lookup | null = null;
let loading: Promise<void> | null = null;

export function loadTimeZones(): Promise<void> {
  loading ??= import("@photostructure/tz-lookup")
    .then((mod) => {
      const m = mod as unknown as { default?: Lookup } & Lookup;
      lookup = typeof m.default === "function" ? m.default : m;
    })
    .catch(() => {
      loading = null; // allow a retry later
    });
  return loading ?? Promise.resolve();
}

const FORMAT: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

function format(date: Date, timeZone: string): string {
  // Newer ICU puts a narrow no-break space before AM/PM; normalize it.
  return date
    .toLocaleTimeString("en-US", { ...FORMAT, timeZone })
    .replace(/\s/g, " ");
}

export function localTime(lat: number, lng: number, date: Date = new Date()): LocalTime {
  if (lookup) {
    try {
      return { text: format(date, lookup(lat, lng)), approximate: false };
    } catch {
      // fall through to solar time
    }
  }
  return { text: solarTime(lng, date), approximate: true };
}

// Mean solar time: UTC shifted 4 minutes per degree of longitude.
export function solarTime(lng: number, date: Date): string {
  return format(new Date(date.getTime() + lng * 4 * 60_000), "UTC");
}
