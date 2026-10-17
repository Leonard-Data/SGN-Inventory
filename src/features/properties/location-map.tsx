'use client';
// Leaflet touches `window`, so this module is only ever imported through a Next.js
// dynamic import with server rendering disabled (see location.tsx).
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import { divIcon } from 'leaflet';
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

function ClickCatcher({ onPick }: { onPick: (point: MapPoint) => void }) {
  useMapEvents({
    click(event) {
      const picked = event.target.wrapLatLng(event.latlng);
      onPick({ lat: picked.lat, lng: picked.lng });
    },
  });
  return null;
}

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
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom={false}
      keyboard={false}
      className="sgn-map"
    >
      <TileLayer
        url={TILE_URL}
        attribution={TILE_ATTRIBUTION}
        eventHandlers={{ tileerror: onTileError }}
      />
      {marker ? (
        <Marker position={marker} icon={pinIcon} interactive={false} />
      ) : null}
      {onPick ? <ClickCatcher onPick={onPick} /> : null}
    </MapContainer>
  );
}
