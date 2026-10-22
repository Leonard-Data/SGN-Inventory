import { api } from './api.ts';
import type { Employee, EmployeeSession } from './types';

// The session values a protected read authorizes on: the same employee with a
// different role or a later access revision is a different session and loses what
// those reads allowed.
export function renderedSession(employee: Employee) {
  return `${employee.id}:${employee.role}`;
}

// The key one session's authorized scope is read, cached and painted under: the employee, their role
// and the server-maintained access revision. Two sessions share a key only when all three agree, so
// a row cached under one key is never shown for another.
export function sessionScope(session: EmployeeSession) {
  return `${renderedSession(session.employee)}:${session.accessRevision}`;
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

// The bounded read gave up without ever observing a stable session, so the surface
// stops instead of reading again.
export class AccessChangedError extends Error {}

export type ProtectedSource<T> =
  string | ((signal: AbortSignal, session: EmployeeSession) => Promise<T>);

export async function loadProtected<T>(options: {
  source: ProtectedSource<T>;
  signal: AbortSignal;
  renderedFor: string | null;
  renderedAccessRevision: number | null;
  onIdentityChange: () => void;
}) {
  const readSource = (session: EmployeeSession) =>
    typeof options.source === 'string'
      ? api<T>(options.source, undefined, options.signal)
      : options.source(options.signal, session);
  // The session read brackets the data read on both sides, so the data is only
  // accepted when the access it was authorized on did not move under it.
  let session = await api<EmployeeSession>(
    '/api/session',
    undefined,
    options.signal,
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    options.signal.throwIfAborted();
    if (
      sessionDiffers(
        options.renderedFor,
        options.renderedAccessRevision,
        session,
      )
    )
      options.onIdentityChange();
    options.signal.throwIfAborted();
    const data = await readSource(session);
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
  }
  throw new AccessChangedError();
}
