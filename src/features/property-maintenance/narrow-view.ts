'use client';
import { useSyncExternalStore } from 'react';
import { NARROW_SECTIONS_QUERY } from './sections';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(NARROW_SECTIONS_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function useNarrowSections(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW_SECTIONS_QUERY).matches,
    // The surface is a dialog and renders nothing until it opens, so the server never
    // paints either shape; the wide shape is the harmless pre-hydration default.
    () => false,
  );
}
