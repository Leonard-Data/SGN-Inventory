'use client';
// Leaflet touches `window`, so this module is only ever imported through a Next.js
// dynamic import with server rendering disabled (see location.tsx).
import { useEffect, useRef } from 'react';
import {
  divIcon,
  map as createMap,
  marker as createMarker,
  tileLayer,
  type Map as LeafletMap,
  type Marker as LeafletMarker,
} from 'leaflet';
import 'leaflet/dist/leaflet.css';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export type MapPoint = { lat: number; lng: number };

// A divIcon avoids Leaflet's default marker image, whose asset paths break under a
// bundler and would need per-environment image plumbing for a single pin.
const pinIcon = divIcon({
  className: 'sgn-map-pin',
  html: `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="var(--accent, #176c58)" stroke="var(--surface, #fff)" stroke-width="1.4"/><circle cx="12" cy="9" r="2.4" fill="var(--surface, #fff)"/></svg>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28],
});

export function LocationMap({
  center,
  marker,
  onPick,
  onTileError,
  zoom = 16,
}: {
  center: [number, number];
  marker: [number, number] | null;
  onPick?: (point: MapPoint) => void;
  onTileError?: () => void;
  zoom?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<LeafletMap | null>(null);
  const pin = useRef<LeafletMarker | null>(null);
  const callbacks = useRef({ onPick, onTileError });
  const start = useRef({ center, zoom });
  const centerLat = center[0];
  const centerLng = center[1];
  const lat = marker ? marker[0] : null;
  const lng = marker ? marker[1] : null;

  useEffect(() => {
    callbacks.current = { onPick, onTileError };
  });

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const map = createMap(node, {
      center: start.current.center,
      zoom: start.current.zoom,
      scrollWheelZoom: false,
      keyboard: false,
    });
    view.current = map;
    const tiles = tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION });
    let loaded = false;
    tiles.on('tileload', () => {
      loaded = true;
    });
    tiles.on('tileerror', () => {
      if (!loaded) callbacks.current.onTileError?.();
    });
    tiles.addTo(map);
    map.on('click', (event) => {
      const picked = map.wrapLatLng(event.latlng);
      callbacks.current.onPick?.({ lat: picked.lat, lng: picked.lng });
    });
    const frame = requestAnimationFrame(() => map.invalidateSize());
    return () => {
      cancelAnimationFrame(frame);
      map.off();
      map.remove();
      view.current = null;
      pin.current = null;
    };
  }, []);

  useEffect(() => {
    const map = view.current;
    if (!map || map.getBounds().contains([centerLat, centerLng])) return;
    map.setView([centerLat, centerLng], undefined, { animate: false });
  }, [centerLat, centerLng]);

  useEffect(() => {
    const map = view.current;
    if (!map || lat === null || lng === null) {
      pin.current?.remove();
      pin.current = null;
      return;
    }
    if (pin.current) pin.current.setLatLng([lat, lng]);
    else
      pin.current = createMarker([lat, lng], {
        icon: pinIcon,
        interactive: false,
      }).addTo(map);
  }, [lat, lng]);

  return <div ref={container} className="sgn-map" />;
}
