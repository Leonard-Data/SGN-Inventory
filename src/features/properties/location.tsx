'use client';
import { useId, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Locale } from '@/i18n/messages';
import { detailMessages } from './messages';
import {
  fields,
  validateChanges,
} from '@/features/property-maintenance/fields';
import { maintenanceText } from '@/features/property-maintenance/messages';
import type { MapPoint } from './location-map';

// Leaflet touches `window`, so the map mounts only in the browser and this module must
// not statically import anything from location-map.tsx (a type-only import is erased).
const LocationMap = dynamic(
  () => import('./location-map').then((m) => m.LocationMap),
  { ssr: false },
);

// A sensible default centre (Ho Chi Minh City) for placing a point on a property that
// has no location yet; a recorded point always centres the map on itself.
const DEFAULT_CENTER: [number, number] = [10.762622, 106.660172];

function parseCoordinate(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
// Exact seven-decimal text round-trips numeric(10,7) and matches the stored ::text value,
// so an untouched point never registers as a spurious change.
function coordinateText(value: number): string {
  return value.toFixed(7);
}
// Shortest round-trip form for display, without the trailing zeros the database keeps.
function coordinateLabel(value: number): string {
  return String(value);
}
function openInMapUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

export function PropertyLocation({
  latitude,
  longitude,
  locale,
}: {
  latitude: string | null;
  longitude: string | null;
  locale: Locale;
}) {
  const dt = detailMessages[locale];
  const [tilesFailed, setTilesFailed] = useState(false);
  const lat = parseCoordinate(latitude),
    lng = parseCoordinate(longitude);
  const point: MapPoint | null =
    lat !== null && lng !== null ? { lat, lng } : null;

  if (!point) {
    return <p className="field-hint">{dt.noLocation}</p>;
  }
  const openLink = openInMapUrl(point.lat, point.lng);

  return (
    <div className="sgn-location">
      {openLink ? (
        <div className="sgn-map-actions">
          <span className="sgn-map-caption">
            {dt.locationRecorded}: {coordinateLabel(point.lat)},{' '}
            {coordinateLabel(point.lng)}
          </span>
          <a
            className="link"
            href={openLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            {dt.openInMap}
          </a>
        </div>
      ) : null}
      <div
        className="sgn-map-frame"
        role="img"
        aria-label={
          dt.locationRecorded +
          ': ' +
          coordinateLabel(point.lat) +
          ', ' +
          coordinateLabel(point.lng)
        }
      >
        <LocationMap
          center={[point.lat, point.lng]}
          marker={[point.lat, point.lng]}
          zoom={16}
          onTileError={() => setTilesFailed(true)}
          onTileLoad={() => setTilesFailed(false)}
        />
      </div>
      {tilesFailed ? <p className="field-hint">{dt.mapUnavailable}</p> : null}
    </div>
  );
}

export function LocationEditor({
  values,
  locale,
}: {
  values: Record<string, unknown>;
  locale: Locale;
}) {
  const mt = maintenanceText(locale);
  const initial = useMemo(() => {
    const lat = parseCoordinate(values.latitude),
      lng = parseCoordinate(values.longitude);
    return lat !== null && lng !== null ? { lat, lng } : null;
  }, [values.latitude, values.longitude]);
  const [point, setPoint] = useState<MapPoint | null>(initial);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [typedLat, setTypedLat] = useState(''),
    [typedLng, setTypedLng] = useState(''),
    [typedInvalid, setTypedInvalid] = useState(false);
  const latId = useId(),
    lngId = useId();
  const center: [number, number] = point
    ? [point.lat, point.lng]
    : DEFAULT_CENTER;
  function applyTyped() {
    try {
      const changes = validateChanges('property', {
        latitude: typedLat.trim(),
        longitude: typedLng.trim(),
      });
      setPoint({
        lat: Number(changes.latitude),
        lng: Number(changes.longitude),
      });
      setTypedInvalid(false);
    } catch {
      setTypedInvalid(true);
    }
  }

  return (
    <div className="field">
      <span className="field-label">{mt.location}</span>
      <p className="field-hint">{mt.locationHint}</p>
      <input
        type="hidden"
        name="latitude"
        value={point ? coordinateText(point.lat) : ''}
      />
      <input
        type="hidden"
        name="longitude"
        value={point ? coordinateText(point.lng) : ''}
      />
      <div
        className="sgn-map-frame"
        role="group"
        aria-label={mt.locationMapLabel}
      >
        <LocationMap
          center={center}
          marker={point ? [point.lat, point.lng] : null}
          zoom={point ? 16 : 11}
          onPick={(picked) =>
            setPoint({
              lat: Number(coordinateText(picked.lat)),
              lng: Number(coordinateText(picked.lng)),
            })
          }
          onTileError={() => setTilesFailed(true)}
          onTileLoad={() => setTilesFailed(false)}
        />
      </div>
      {tilesFailed ? (
        <p className="field-hint">{mt.locationTilesFailed}</p>
      ) : null}
      {point ? (
        <div className="sgn-map-actions">
          <span className="sgn-map-caption">
            {mt.locationRecorded}: {coordinateLabel(point.lat)},{' '}
            {coordinateLabel(point.lng)}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setPoint(null)}
          >
            {mt.locationClear}
          </button>
        </div>
      ) : (
        <p className="sgn-map-caption">{mt.locationNoPoint}</p>
      )}
      <div className="field">
        <span className="field-label">{mt.locationTyped}</span>
        <p className="field-hint">{mt.locationTypedHint}</p>
        <div className="sgn-map-actions">
          <div className="field">
            <label className="field-label" htmlFor={latId}>
              {fields.latitude![locale]}
            </label>
            <input
              id={latId}
              className="input"
              type="text"
              inputMode="decimal"
              value={typedLat}
              onChange={(event) => setTypedLat(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={lngId}>
              {fields.longitude![locale]}
            </label>
            <input
              id={lngId}
              className="input"
              type="text"
              inputMode="decimal"
              value={typedLng}
              onChange={(event) => setTypedLng(event.target.value)}
            />
          </div>
          <button type="button" className="btn btn-sm" onClick={applyTyped}>
            {mt.locationApply}
          </button>
        </div>
        {typedInvalid ? (
          <p role="alert" className="field-error">
            {mt.locationInvalid}
          </p>
        ) : null}
      </div>
    </div>
  );
}
