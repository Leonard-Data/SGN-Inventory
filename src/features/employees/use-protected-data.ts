'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Employee } from './types';
import { api, RequestError } from './api';

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
  const savedLocale = useRef<{
    employeeId: string;
    locale: Employee['locale'];
    revision: number;
  } | null>(null);
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
    setData(null);
    setEmployee(null);
  }, [conceal]);
  const load = useCallback(async () => {
    invalidate();
    const version = generation.current;
    const localeRevision = savedLocale.current?.revision ?? 0;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const [session, result] = await Promise.all([
        api<{ employee: Employee }>('/api/session', undefined, abort.signal),
        typeof source === 'string'
          ? api<T>(source, undefined, abort.signal)
          : source(abort.signal),
      ]);
      if (version !== generation.current) return;
      const latest = savedLocale.current;
      const active =
        latest &&
        latest.revision !== localeRevision &&
        latest.employeeId === session.employee.id
          ? { ...session.employee, locale: latest.locale }
          : session.employee;
      setEmployee(active);
      setData(result);
      setError(null);
      document.documentElement.lang = active.locale;
      if (surfaceElement.current) surfaceElement.current.hidden = false;
    } catch (failure) {
      if (version !== generation.current || abort.signal.aborted) return;
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
  function applyLocale(locale: Employee['locale'], employeeId: string) {
    savedLocale.current = {
      locale,
      employeeId,
      revision: (savedLocale.current?.revision ?? 0) + 1,
    };
    setEmployee((current) =>
      current?.id === employeeId ? { ...current, locale } : current,
    );
    document.documentElement.lang = locale;
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
    applyLocale,
  };
}
