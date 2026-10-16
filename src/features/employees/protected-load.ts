import { api, isPropertyAccessFailure, RequestError } from './api.ts';
import type { Employee, EmployeeSession } from './types';

// The session values a protected read authorizes on: the same employee with a
// different role is a different session and loses what those reads allowed.
export function renderedSession(employee: Employee) {
  return `${employee.id}:${employee.role}`;
}

export function sessionDiffers(
  renderedFor: string | null,
  renderedAccessRevision: number | null,
  session: EmployeeSession,
) {
  return (
    renderedFor !== renderedSession(session.employee) ||
    renderedAccessRevision !== session.accessRevision
  );
}

export function isProtectedInvalidation(failure: unknown) {
  return (
    failure instanceof RequestError &&
    ([401, 403].includes(failure.status) || isPropertyAccessFailure(failure))
  );
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
  renderedAccessRevision: number | null;
  onIdentityChange: () => void;
}) {
  let sourcePromise =
    typeof options.source === 'string'
      ? api<T>(options.source, undefined, options.signal)
      : options.source(options.signal);
  void sourcePromise.catch(() => {});
  let session = await api<EmployeeSession>(
    '/api/session',
    undefined,
    options.signal,
  );
  for (;;) {
    options.signal.throwIfAborted();
    if (
      options.renderedFor !== null &&
      sessionDiffers(
        options.renderedFor,
        options.renderedAccessRevision,
        session,
      )
    )
      options.onIdentityChange();
    options.signal.throwIfAborted();
    const data = await sourcePromise;
    options.signal.throwIfAborted();
    const current = await api<EmployeeSession>(
      '/api/session',
      undefined,
      options.signal,
    );
    options.signal.throwIfAborted();
    if (
      !sessionDiffers(
        renderedSession(session.employee),
        session.accessRevision,
        current,
      )
    )
      return {
        employee: current.employee,
        data,
        accessRevision: current.accessRevision,
      };
    if (options.renderedFor !== null) options.onIdentityChange();
    options.signal.throwIfAborted();
    session = current;
    sourcePromise =
      typeof options.source === 'string'
        ? api<T>(options.source, undefined, options.signal)
        : options.source(options.signal);
    void sourcePromise.catch(() => {});
  }
}
