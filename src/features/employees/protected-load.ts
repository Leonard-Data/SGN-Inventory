import { api } from './api.ts';
import type { Employee } from './types';

// The session values a protected read authorizes on: the same employee with a
// different role is a different session and loses what those reads allowed.
export function renderedSession(employee: Employee) {
  return `${employee.id}:${employee.role}`;
}

// What a window refocus does with a protected surface. A read already in flight
// decides what the surface shows; a displayed snapshot is only rechecked against
// live membership; a surface with nothing displayed reads again before showing
// anything.
export function refocusAction(
  renderedFor: string | null,
  reading: boolean,
): 'none' | 'recheck' | 'reload' {
  if (reading) return 'none';
  return renderedFor ? 'recheck' : 'reload';
}

export async function loadProtected<T>(options: {
  source: string | ((signal: AbortSignal) => Promise<T>);
  signal: AbortSignal;
  renderedFor: string | null;
  onIdentityChange: () => void;
}) {
  const sourcePromise =
    typeof options.source === 'string'
      ? api<T>(options.source, undefined, options.signal)
      : options.source(options.signal);
  void sourcePromise.catch(() => {});
  const session = await api<{ employee: Employee }>(
    '/api/session',
    undefined,
    options.signal,
  );
  options.signal.throwIfAborted();
  if (renderedSession(session.employee) !== options.renderedFor)
    options.onIdentityChange();
  const data = await sourcePromise;
  options.signal.throwIfAborted();
  return { employee: session.employee, data };
}
