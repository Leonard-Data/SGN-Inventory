'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Employee, EmployeeSession } from './types';
import { api, RequestError } from './api';
import {
  AccessChangedError,
  loadProtected,
  refocusAction,
  renderedSession,
  sessionDiffers,
} from './protected-load';

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
  const renderedAccessRevision = useRef<number | null>(null);
  // True while a read will publish or clear the surface: that read decides what
  // the surface shows, so a window focus during it has nothing to do.
  const reading = useRef(false);
  const bindSurface = useCallback((element: HTMLDivElement | null) => {
    surfaceElement.current = element;
  }, []);
  const invalidate = useCallback(() => {
    generation.current++;
    controller.current?.abort();
  }, []);
  const conceal = useCallback(() => {
    invalidate();
    reading.current = false;
    if (surfaceElement.current) surfaceElement.current.hidden = true;
  }, [invalidate]);
  const clear = useCallback(() => {
    conceal();
    renderedFor.current = null;
    renderedAccessRevision.current = null;
    setData(null);
    setEmployee(null);
  }, [conceal]);
  const load = useCallback(async () => {
    invalidate();
    setBusy(true);
    // The read that just started decides what the surface shows.
    reading.current = true;
    const version = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const {
        employee: sessionEmployee,
        data: result,
        accessRevision: sessionAccessRevision,
      } = await loadProtected<T>({
        source,
        signal: abort.signal,
        renderedFor: renderedFor.current,
        renderedAccessRevision: renderedAccessRevision.current,
        onIdentityChange: () => {
          if (surfaceElement.current) surfaceElement.current.hidden = true;
          renderedFor.current = null;
          renderedAccessRevision.current = null;
          setData(null);
          setEmployee(null);
        },
      });
      if (version !== generation.current) return;
      setEmployee(sessionEmployee);
      setData(result);
      renderedFor.current = renderedSession(sessionEmployee);
      renderedAccessRevision.current = sessionAccessRevision;
      setError(null);
      if (surfaceElement.current) surfaceElement.current.hidden = false;
    } catch (failure) {
      if (version !== generation.current || abort.signal.aborted) return;
      renderedFor.current = null;
      renderedAccessRevision.current = null;
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
      setError(
        failure instanceof AccessChangedError
          ? 'access-changed'
          : failure instanceof RequestError
            ? failure.code
            : 'unavailable',
      );
    } finally {
      if (version === generation.current) {
        reading.current = false;
        setBusy(false);
      }
    }
  }, [source, invalidate]);
  const reload = useCallback(() => {
    setBusy(true);
    setError(null);
    return load();
  }, [load]);
  // A visible surface is still valid, so a window focus rechecks live membership
  // and authority (docs/database-contract.md) without reading the data it shows.
  const revalidate = useCallback(async () => {
    // Nothing has been published for this surface yet, so the read in flight owns it.
    if (!renderedFor.current) return;
    try {
      const session = await api<EmployeeSession>('/api/session');
      if (
        sessionDiffers(
          renderedFor.current,
          renderedAccessRevision.current,
          session,
        )
      ) {
        conceal();
        void reload();
      }
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
  }, [clear, conceal, reload]);
  useEffect(() => {
    // load() enters the loading state synchronously so a source change (paging)
    // keeps truthful feedback instead of blanking the surface; the rule flags
    // that deliberate update as a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional loading state for a new source
    void load();
    const focus = () => {
      const action = refocusAction(renderedFor.current, reading.current);
      if (action === 'reload') void reload();
      else if (action === 'recheck') void revalidate();
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
