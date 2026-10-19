// The page-level confirmation queue. A save that commits closes the surface it was saved
// from and confirms here; a refused or failed save keeps that surface and its input with the
// reason in place, so it raises nothing - a refusal is never a success tone.
export type ToastTone = 'success' | 'danger' | 'neutral';

export type SaveOutcome =
  { saved: true; message: string; tone?: ToastTone } | { saved: false };

export type Toast = {
  id: string;
  tone: ToastTone;
  message: string;
  expiresAt: number;
};

// Long enough to read one confirmation without hurrying a Vietnamese line.
export const TOAST_DURATION_MS = 6000;
// A pile of confirmations covers the page it confirms, and the page is the record.
export const MAX_TOASTS = 3;

export function toastFor(
  outcome: SaveOutcome,
  id: string,
  now: number,
): Toast | null {
  if (!outcome.saved) return null;
  return {
    id,
    tone: outcome.tone ?? 'success',
    message: outcome.message,
    expiresAt: now + TOAST_DURATION_MS,
  };
}

export function pushToast(list: Toast[], toast: Toast | null): Toast[] {
  if (!toast) return list;
  return [...list, toast].slice(-MAX_TOASTS);
}

export function dismissToast(list: Toast[], id: string): Toast[] {
  return list.filter((toast) => toast.id !== id);
}

export function expireToasts(list: Toast[], now: number): Toast[] {
  const live = list.filter((toast) => toast.expiresAt > now);
  return live.length === list.length ? list : live;
}
