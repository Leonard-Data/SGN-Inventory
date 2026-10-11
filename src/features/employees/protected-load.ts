import { api } from './api';
import type { Employee } from './types';

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
  if (session.employee.id !== options.renderedFor) options.onIdentityChange();
  const data = await sourcePromise;
  options.signal.throwIfAborted();
  return { employee: session.employee, data };
}
