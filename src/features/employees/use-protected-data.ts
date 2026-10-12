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
  const bindSurface = useCallback((element: HTMLDivElement | null) => {
    surfaceElement.current = element;
  }, []);
  const invalidate = useCallback(() => {
    generation.current++;
    controller.current?.abort();
  }, []);
  const conceal = useCallback(() => {
    invalidate();
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
      document.documentElement.lang = sessionEmployee.locale;
      if (surfaceElement.current) surfaceElement.current.hidden = false;
    } catch (failure) {
      if (version !== generation.current || abort.signal.aborted) return;
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
  useEffect(() => {
    void load();
    const focus = () => {
      void reload();
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
  }, [load, reload, clear, conceal]);
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
