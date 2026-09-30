"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import type { GeoJSONSource, Map as MapboxMap, Marker } from "mapbox-gl";
import type { PeerDot } from "@/lib/types";
import { darkness } from "@/lib/sun";
import { circleRingKm } from "@/lib/geo";
import { localTime } from "@/lib/localtime";
import { skyAt } from "@/lib/sky";
import type { Theme } from "@/lib/themes";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

// Night deepens through civil, nautical and astronomical twilight: one
// translucent layer per band, so overlaps darken smoothly.
const DARKNESS_BANDS = [0, -6, -12, -18];
const NIGHT_REFRESH_MS = 60_000;
const FLARE_MS = 1_600;
const SPIN_DEG_PER_SEC = 4;

export interface LatLng {
  lat: number;
  lng: number;
}

// Your real location (only ever on your own screen) and the offset position
// everyone else sees.
export interface MePosition {
  real: LatLng;
  public: LatLng;
}

// A request to move the camera; a new `key` triggers a new flight.
export interface FlyRequest {
  key: number;
  center: [number, number]; // [lng, lat]
  zoom: number;
}

interface Props {
  peers: PeerDot[];
  me: MePosition | null;
  live: boolean; // false: entry backdrop (spins, not interactive)
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  theme: Theme;
  flyTo: FlyRequest | null;
}

interface DotEntry {
  marker: Marker;
  wrapper: HTMLDivElement;
  dot: HTMLButtonElement;
  busy: boolean;
}

const EMPTY = { type: "FeatureCollection" as const, features: [] };

function nightData(now: Date) {
  return {
    type: "FeatureCollection" as const,
    features: DARKNESS_BANDS.map((altitude) => ({
      type: "Feature" as const,
      properties: { altitude },
      geometry: darkness(now, altitude),
    })),
  };
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

// Dress the base Mapbox style in the theme: tint land and water, set the
// atmosphere, colour our own layers, and drop the minor labels so the globe
// stays calm at every zoom.
function applyTheme(map: MapboxMap, theme: Theme) {
  const { land, landuse, water } = theme.tint;
  if (land && map.getLayer("land")) {
    map.setPaintProperty("land", "background-color", land);
  }
  if (landuse) {
    for (const id of ["national-park", "landuse", "land-structure-polygon"]) {
      if (map.getLayer(id)) map.setPaintProperty(id, "fill-color", landuse);
    }
  }
  if (water && map.getLayer("water")) map.setPaintProperty("water", "fill-color", water);
  for (const id of [
    "poi-label",
    "road-label-simple",
    "airport-label",
    "natural-point-label",
    "natural-line-label",
    "waterway-label",
    "settlement-subdivision-label",
  ]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  }
  map.setFog(theme.fog);
  if (map.getLayer("night")) {
    map.setPaintProperty("night", "fill-color", theme.night.color);
    map.setPaintProperty("night", "fill-opacity", theme.night.opacity);
  }
  if (map.getLayer("privacy-ring")) {
    map.setPaintProperty("privacy-ring", "fill-color", theme.colors.glow);
  }
  if (map.getLayer("public-me")) {
    map.setPaintProperty("public-me", "circle-stroke-color", theme.colors.glow);
  }
}

function flare(el: HTMLElement) {
  el.classList.remove("flare");
  void el.offsetWidth; // restart the animation
  el.classList.add("flare");
  window.setTimeout(() => el.classList.remove("flare"), FLARE_MS);
}

export default function WorldMap({
  peers,
  me,
  live,
  selectedId,
  onSelect,
  theme,
  flyTo,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef(new Map<string, DotEntry>());
  const meMarkerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [nightBands, setNightBands] = useState(0);
  // Bumped each time a (re)loaded style has our layers — "you" layers refill.
  const [styleVersion, setStyleVersion] = useState(0);
  // Test/debug hooks written straight to the DOM (no re-render per frame).
  const wrapperRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef(theme);
  const loadedStyleUrl = useRef(theme.mapStyle);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
  // The entry backdrop spins, unless the user prefers reduced motion.
  const spinning = ready && !live && !reducedMotion;

  // Marker click handlers are bound once; read the live callback via a ref.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
    themeRef.current = theme;
  });

  // 1) Map, globe atmosphere, night layers, "you" layers.
  useEffect(() => {
    if (!TOKEN || !containerRef.current) return;
    let cancelled = false;
    let nightTimer: ReturnType<typeof setInterval> | undefined;
    const markers = markersRef.current;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = TOKEN;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: themeRef.current.mapStyle,
        projection: "globe",
        center: [100, 15],
        zoom: 1.6,
        attributionControl: false,
      });
      map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
      mapRef.current = map;

      // Runs for the first style and again after every theme change that
      // swaps the base style (which drops our sources and layers).
      map.on("style.load", () => {
        // Keep place labels readable on top of the night side.
        const firstLabel = map.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
        map.addSource("night", { type: "geojson", data: nightData(new Date()) });
        map.addLayer(
          {
            id: "night",
            type: "fill",
            source: "night",
            paint: { "fill-color": "#010209", "fill-opacity": 0.2, "fill-antialias": false },
          },
          firstLabel,
        );
        map.addSource("privacy-ring", { type: "geojson", data: EMPTY });
        map.addLayer(
          {
            id: "privacy-ring",
            type: "fill",
            source: "privacy-ring",
            paint: { "fill-color": "#ffd9a8", "fill-opacity": 0.08 },
          },
          firstLabel,
        );
        map.addSource("public-me", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "public-me",
          type: "circle",
          source: "public-me",
          paint: {
            "circle-radius": 5,
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": "#ffd9a8",
            "circle-stroke-width": 1.5,
            "circle-stroke-opacity": 0.8,
          },
        });
        applyTheme(map, themeRef.current);
        if (cancelled) return;
        setNightBands(DARKNESS_BANDS.length);
        setReady(true);
        setStyleVersion((v) => v + 1);
        if (wrapperRef.current) wrapperRef.current.dataset.mapStyle = themeRef.current.id;
      });

      map.on("moveend", () => {
        const c = map.getCenter();
        if (wrapperRef.current) {
          wrapperRef.current.dataset.center = `${c.lng.toFixed(2)},${c.lat.toFixed(2)}`;
        }
      });

      nightTimer = setInterval(() => {
        (map.getSource("night") as GeoJSONSource | undefined)?.setData(nightData(new Date()));
      }, NIGHT_REFRESH_MS);

      // Clicking empty map deselects (dot clicks stop propagation).
      map.on("click", () => onSelectRef.current(null));
    })();

    return () => {
      cancelled = true;
      if (nightTimer) clearInterval(nightTimer);
      markers.forEach(({ marker }) => marker.remove());
      markers.clear();
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // 2) Entry backdrop spins slowly and ignores input; going live flies to you.
  const meKey = me ? `${me.real.lat},${me.real.lng}` : "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const handlers = [
      map.dragPan,
      map.scrollZoom,
      map.boxZoom,
      map.dragRotate,
      map.keyboard,
      map.doubleClickZoom,
      map.touchZoomRotate,
    ];
    if (!live) {
      handlers.forEach((h) => h.disable());
      if (!spinning) return;
      let active = true;
      const spin = () => {
        if (!active) return;
        const c = map.getCenter();
        map.easeTo({
          center: [c.lng + SPIN_DEG_PER_SEC, c.lat],
          duration: 1000,
          easing: (t) => t,
        });
      };
      map.on("moveend", spin);
      spin();
      return () => {
        active = false;
        map.off("moveend", spin);
        map.stop();
      };
    }
    handlers.forEach((h) => h.enable());
    if (meKey) {
      const [lat, lng] = meKey.split(",").map(Number);
      map.flyTo({ center: [lng, lat], zoom: 3.2, duration: 2800, essential: true });
    }
  }, [live, ready, spinning, meKey]);

  // Theme changes: swap the base style if it differs (style.load re-adds our
  // layers and applies the theme), otherwise restyle in place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (theme.mapStyle !== loadedStyleUrl.current) {
      loadedStyleUrl.current = theme.mapStyle;
      // A full reload (not a diff) so style.load fires and re-adds our layers.
      map.setStyle(theme.mapStyle, {
        diff: false,
      } as Parameters<MapboxMap["setStyle"]>[1]);
    } else {
      applyTheme(map, theme);
      if (wrapperRef.current) wrapperRef.current.dataset.mapStyle = theme.id;
    }
  }, [theme, ready]);

  // Explore: fly wherever we're asked (a new request key means a new flight).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !flyTo) return;
    map.flyTo({ center: flyTo.center, zoom: flyTo.zoom, duration: 2200 });
  }, [flyTo, ready]);

  // 3) You: marker at your real location, the 1–3 km ring your dot is placed
  // in, and a hollow marker where others actually see you.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me) return;
    let cancelled = false;
    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      if (!meMarkerRef.current) {
        const el = document.createElement("div");
        el.className = "pulse-me";
        el.title = "You — others see your dot somewhere 1–3 km from here";
        el.innerHTML =
          '<span class="pulse-me-core"></span><span class="pulse-me-label">You</span>';
        meMarkerRef.current = new mapboxgl.Marker({ element: el, occludedOpacity: 0 })
          .setLngLat([me.real.lng, me.real.lat])
          .addTo(map);
      } else {
        meMarkerRef.current.setLngLat([me.real.lng, me.real.lat]);
      }
      (map.getSource("privacy-ring") as GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [
            circleRingKm(me.real.lat, me.real.lng, 3),
            circleRingKm(me.real.lat, me.real.lng, 1).reverse(),
          ],
        },
      });
      (map.getSource("public-me") as GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [me.public.lng, me.public.lat] },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [me, ready, styleVersion]);

  // 4) Strangers: ember dots reconciled on every poll. A dot that just became
  // busy flares — someone somewhere started a conversation.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;
    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      const markers = markersRef.current;
      const seen = new Set<string>();
      const now = new Date();

      for (const peer of peers) {
        seen.add(peer.id);
        let entry = markers.get(peer.id);
        if (!entry) {
          const wrapper = document.createElement("div");
          wrapper.className = "pulse-marker";
          const dot = document.createElement("button");
          dot.type = "button";
          dot.className = "pulse-dot";
          dot.dataset.peerId = peer.id;
          dot.addEventListener("click", (e) => {
            e.stopPropagation();
            onSelectRef.current(peer.id);
          });
          wrapper.appendChild(dot);
          const marker = new mapboxgl.Marker({ element: wrapper, occludedOpacity: 0 })
            .setLngLat([peer.lng, peer.lat])
            .addTo(map);
          entry = { marker, wrapper, dot, busy: peer.busy };
          markers.set(peer.id, entry);
        } else if (peer.busy && !entry.busy) {
          flare(entry.wrapper);
        }
        entry.busy = peer.busy;
        entry.dot.classList.toggle("is-busy", peer.busy);
        entry.dot.classList.toggle("is-selected", peer.id === selectedId);
        const time = localTime(peer.lat, peer.lng, now);
        const label = `Stranger · ${time.approximate ? "~" : ""}${time.text} · ${skyAt(
          peer.lat,
          peer.lng,
          now,
        )}${peer.busy ? " · in a conversation" : ""}`;
        entry.dot.dataset.label = label;
        entry.dot.setAttribute("aria-label", label);
      }

      for (const [id, { marker }] of markers) {
        if (!seen.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [peers, ready, selectedId]);

  return (
    <div
      ref={wrapperRef}
      className="absolute inset-0"
      data-night-bands={nightBands}
      data-spinning={spinning ? "true" : "false"}
    >
      <div ref={containerRef} className="h-full w-full bg-space" />
      {!TOKEN && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p className="glass max-w-md rounded-2xl p-5 text-center text-sm text-ink">
            Set <code className="text-glow">NEXT_PUBLIC_MAPBOX_TOKEN</code> in{" "}
            <code>.env</code> to load the globe.
          </p>
        </div>
      )}
    </div>
  );
}
