import { Moon, MoonStar, Sun, Sunrise, Sunset } from "lucide-react";
import type { Sky } from "@/lib/sky";

const ICONS: Record<Sky, typeof Sun> = {
  night: Moon,
  "before dawn": MoonStar,
  dawn: Sunrise,
  "golden hour": Sunset,
  daytime: Sun,
  dusk: Sunset,
  "late dusk": MoonStar,
};

export default function SkyIcon({ sky, className }: { sky: Sky; className?: string }) {
  const Icon = ICONS[sky];
  return <Icon className={className} aria-hidden />;
}
