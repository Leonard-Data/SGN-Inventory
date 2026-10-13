'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Employee } from './types';
import { api, RequestError } from './api';
import { loadProtected } from './protected-load';

export function useProtectedData<T>(
  source: string | ((signal: AbortSignal) => Promise<T>),
) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const surfaceElement = useRef<HTMLDivElement | null>(null);
  const renderedFor = useRef<string | null>(null);
  // True while the surface is concealed with no successful read behind it: only then
  // does a window focus have to read the data again before showing anything.
  const concealed = useRef(false);
  const bindSurface = useCallback((element: HTMLDivElement | null) => {
    surfaceElement.current = element;
  }, []);
  const invalidate = useCallback(() => {
    generation.current++;
    controller.current?.abort();
  }, []);
  const conceal = useCallback(() => {
    invalidate();
    concealed.current = true;
    if (surfaceElement.current) surfaceElement.current.hidden = true;
  }, [invalidate]);
  const clear = useCallback(() => {
    conceal();
    renderedFor.current = null;
    setData(null);
    setEmployee(null);
  }, [conceal]);
  const load = useCallback(async () => {
    invalidate();
    // A read is in flight and decides what the surface shows, so it is no longer a
    // concealed surface waiting for one.
    concealed.current = false;
    const version = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const { employee: sessionEmployee, data: result } =
        await loadProtected<T>({
          source,
          signal: abort.signal,
          renderedFor: renderedFor.current,
          onIdentityChange: () => {
            concealed.current = true;
            if (surfaceElement.current) surfaceElement.current.hidden = true;
            renderedFor.current = null;
            setData(null);
            setEmployee(null);
          },
        });
      if (version !== generation.current) return;
      setEmployee(sessionEmployee);
      setData(result);
      renderedFor.current = sessionEmployee.id;
      setError(null);
      if (surfaceElement.current) surfaceElement.current.hidden = false;
    } catch (failure) {
      if (version !== generation.current || abort.signal.aborted) return;
      concealed.current = true;
      renderedFor.current = null;
      setData(null);
      setEmployee(null);
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        window.location.replace(
          failure.status === 403 ? '/access-denied' : '/login',
        );
        return;
      }
      setError(failure instanceof RequestError ? failure.code : 'unavailable');
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }, [source, invalidate]);
  const reload = useCallback(() => {
    setBusy(true);
    setError(null);
    return load();
  }, [load]);
  // A visible surface is still valid, so a window focus rechecks live membership
  // (docs/database-contract.md) without reading the data it already shows.
  const revalidate = useCallback(async () => {
    // Nothing has been published for this surface yet, so the read in flight owns it.
    if (!renderedFor.current) return;
    try {
      const session = await api<{ employee: Employee }>('/api/session');
      if (session.employee.id !== renderedFor.current) void reload();
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        clear();
        window.location.replace(
          failure.status === 403 ? '/access-denied' : '/login',
        );
        return;
      }
      // An inconclusive check keeps the established focus failure behaviour: read
      // again, clearing what is displayed when that read fails too.
      void reload();
    }
  }, [clear, reload]);
  useEffect(() => {
    void load();
    const focus = () => {
      if (concealed.current) {
        void reload();
      } else {
        void revalidate();
      }
    };
    const hide = () => {
      clear();
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) void reload();
    };
    const channel = new BroadcastChannel('sgn-session');
    channel.onmessage = () => {
      clear();
      window.location.replace('/login');
    };
    window.addEventListener('focus', focus);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      conceal();
      channel.close();
      window.removeEventListener('focus', focus);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  }, [load, reload, clear, conceal, revalidate]);
  async function logout() {
    clear();
    setBusy(true);
    try {
      await api('/api/auth/logout', {});
      const channel = new BroadcastChannel('sgn-session');
      channel.postMessage('signed-out');
      channel.close();
      window.location.replace('/login');
    } catch {
      setError('sign-out-failed');
      setBusy(false);
    }
  }
  return {
    employee,
    data,
    error,
    busy,
    surface: bindSurface,
    clear,
    reload,
    logout,
  };
}
