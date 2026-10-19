'use client';
import { useSyncExternalStore } from 'react';

// The clock a "how long ago" phrase reads. It answers null until the page has hydrated, so the
// server render and the first client render state the recorded timestamp instead of a phrase
// built from two clocks that may disagree; the phrase replaces it once the browser's own clock
// has answered, and moves on every minute after that.
const MINUTE_MS = 60_000;

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, MINUTE_MS);
  return () => clearInterval(timer);
}

// Whole minutes: the value only changes when the phrase could, and two reads in the same minute
// return the same number, so the store never asks for a render that changes nothing.
const nowOnClient = () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
const nowOnServer = () => null;

export function useRelativeNow(): number | null {
  return useSyncExternalStore(subscribe, nowOnClient, nowOnServer);
}
