'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { label, messages, type Locale } from '@/i18n/messages';
import { api, RequestError } from '@/features/employees/api';
import type { Employee } from '@/features/employees/types';
import { ToastProvider } from '@/features/toasts/toast-host';
import { visibleNavGroups } from './navigation';

const ICONS: Record<string, ReactNode> = {
  search: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20.5 20.5 16.7 16.7" />
    </svg>
  ),
  plus: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  inbox: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12h5l2 3h4l2-3h5" />
      <path d="M6 4h12l3 8v8H3v-8l3-8z" />
    </svg>
  ),
  chart: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  ),
  people: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c0-3 2.5-4.8 5.5-4.8s5.5 1.8 5.5 4.8" />
      <path d="M16.4 5.7a3.2 3.2 0 0 1 0 6.2M17.9 19.5c0-2.1-.7-3.6-1.8-4.5" />
    </svg>
  ),
};

const DESKTOP_QUERY = '(min-width: 1040px)';
function subscribeDesktop(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const desktopSnapshot = () => window.matchMedia(DESKTOP_QUERY).matches;
const serverDesktop = () => false;

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

function requestSignIn(error: unknown) {
  if (
    error instanceof RequestError &&
    (error.status === 401 || error.status === 403)
  ) {
    window.location.replace(error.status === 403 ? '/access-denied' : '/login');
    return true;
  }
  return false;
}

function LanguageSwitch({ locale }: { locale: Locale }) {
  const text = messages[locale];
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change(next: Locale) {
    if (next === locale || saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await api('/api/locale', { locale: next });
      // The root layout reads the locale cookie, so the refresh re-renders the
      // document language with the new preference.
      router.refresh();
    } catch (failure) {
      if (!requestSignIn(failure)) setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {failed ? (
        <p className="alert" data-tone="danger" role="alert">
          {text.savedLocaleFailed}
        </p>
      ) : null}
      <div className="lang-switch" role="group" aria-label={text.language}>
        {(
          [
            ['vi', text.viLanguage, 'VI'],
            ['en', text.enLanguage, 'EN'],
          ] as const
        ).map(([code, full, brief]) => (
          <button
            key={code}
            type="button"
            className="lang-btn"
            lang={code}
            aria-pressed={locale === code ? 'true' : 'false'}
            disabled={saving}
            onClick={() => void change(code)}
          >
            <span className="lang-full">{full}</span>
            <span className="lang-brev">{brief}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function UserMenu({
  locale,
  employee,
}: {
  locale: Locale;
  employee: Employee;
}) {
  const text = messages[locale];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (host.current && !host.current.contains(event.target as Node))
        setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function signOut() {
    setBusy(true);
    setFailed(false);
    try {
      await api('/api/auth/logout', {});
      const channel = new BroadcastChannel('sgn-session');
      channel.postMessage('signed-out');
      channel.close();
      window.location.replace('/login');
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="sgn-user" ref={host}>
      <button
        type="button"
        className="sgn-user-btn"
        aria-expanded={open ? 'true' : 'false'}
        onClick={() => setOpen(!open)}
      >
        <span className="sgn-avatar" aria-hidden="true">
          {initials(employee.displayName)}
        </span>
        <span className="sgn-user-copy">
          <b>{employee.displayName}</b>
          <span>{label(locale, employee.role)}</span>
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="sgn-popover">
          {failed ? (
            <p className="sgn-popover-note" role="alert">
              {text.signOutFailed}
            </p>
          ) : null}
          <Link href="/profile" onClick={() => setOpen(false)}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
            </svg>
            <span>{text.employeeProfileTitle}</span>
          </Link>
          <hr />
          <button type="button" disabled={busy} onClick={() => void signOut()}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M15 4h4v16h-4M11 8l-4 4 4 4M7 12h9" />
            </svg>
            <span>{text.logout}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({
  locale,
  employee: given,
  children,
}: {
  locale: Locale;
  // Review routes render the shell without a session; product routes omit it and
  // the shell reads /api/session itself.
  employee?: Employee;
  children: ReactNode;
}) {
  const text = messages[locale];
  const pathname = usePathname();
  const [employee, setEmployee] = useState<Employee | null>(given ?? null);
  const [drawer, setDrawer] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    desktopSnapshot,
    serverDesktop,
  );
  const sidebarExpanded = desktop ? !sidebarCollapsed : drawer;
  const aside = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  // The proxy already rejects an unauthenticated request for these routes; this
  // read is only for the account menu and the role filter.
  useEffect(() => {
    if (given) return undefined;
    const abort = new AbortController();
    void api<{ employee: Employee }>('/api/session', undefined, abort.signal)
      .then((session) => setEmployee(session.employee))
      .catch(() => {});
    return () => abort.abort();
  }, [given]);

  // The profile page reports the name it saved, so the menu shows the recorded name without a
  // second session read of its own.
  useEffect(() => {
    function onProfile(event: Event) {
      const detail = (event as CustomEvent<{ displayName?: unknown }>).detail;
      const name = detail?.displayName;
      if (typeof name !== 'string' || !name.trim()) return;
      setEmployee((current) =>
        current ? { ...current, displayName: name } : current,
      );
    }
    window.addEventListener('sgn-profile', onProfile);
    return () => window.removeEventListener('sgn-profile', onProfile);
  }, []);

  useEffect(() => {
    if (!drawer || desktop) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDrawer(false);
        menuButton.current?.focus();
        return;
      }
      if (event.key !== 'Tab' || !aside.current) return;
      const focusable = aside.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    aside.current?.querySelector<HTMLElement>('a[href]')?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawer, desktop]);

  const groups = employee ? visibleNavGroups(employee.role) : [];
  // A nested destination matches its own rail item exactly; the section item keeps
  // its highlight only when no item matches the path exactly (/properties/new).
  const exactNavPath = groups.some((group) =>
    group.items.some((item) => item.href === pathname),
  );
  const crumbs: { label: string; href?: string }[] = [];
  if (pathname === '/properties') crumbs.push({ label: text.inventory });
  else if (pathname.startsWith('/properties/'))
    crumbs.push({ label: text.inventory, href: '/properties' });
  else if (pathname.startsWith('/people')) crumbs.push({ label: text.people });

  return (
    <ToastProvider locale={locale}>
      <div className={sidebarCollapsed ? 'sgn-app is-collapsed' : 'sgn-app'}>
        <a className="sgn-skip" href="#main-content">
          {text.skipToContent}
        </a>
        <aside
          id="sgn-sidebar"
          inert={!sidebarExpanded}
          ref={aside}
          className={drawer ? 'sgn-sidebar is-open' : 'sgn-sidebar'}
        >
          <div className="sgn-lockup">
            <span className="logo-tile">
              <Image src="/brand/logo.png" alt="" width={192} height={165} />
            </span>
            <span className="sgn-brand-name">
              Saigon New House
              <span>{text.brandRole}</span>
            </span>
          </div>
          <nav className="sgn-nav" aria-label={text.title}>
            {groups.map((group) => (
              <div className="sgn-nav-group" key={group.label}>
                <p className="sgn-nav-label">{text[group.label]}</p>
                {group.items.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="sgn-nav-item"
                    onClick={() => setDrawer(false)}
                    aria-current={
                      pathname === item.href ||
                      (!exactNavPath && pathname.startsWith(`${item.href}/`))
                        ? 'page'
                        : undefined
                    }
                  >
                    {ICONS[item.icon]}
                    <span>{text[item.label]}</span>
                  </Link>
                ))}
              </div>
            ))}
          </nav>
          <p className="sgn-sidebar-foot">{text.footNote}</p>
        </aside>
        {drawer && !desktop ? (
          <button
            type="button"
            className="sgn-scrim"
            aria-label={text.close}
            onClick={() => {
              setDrawer(false);
              menuButton.current?.focus();
            }}
          />
        ) : null}
        <div className="sgn-main">
          <header className="sgn-topbar">
            <button
              ref={menuButton}
              className="sgn-menu-btn"
              type="button"
              aria-expanded={sidebarExpanded}
              aria-controls="sgn-sidebar"
              aria-label={sidebarExpanded ? text.close : text.openMenu}
              onClick={() => {
                if (!desktop) {
                  setDrawer(!drawer);
                } else {
                  setSidebarCollapsed(!sidebarCollapsed);
                }
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            <nav className="sgn-crumbs" aria-label={text.breadcrumb}>
              {crumbs.map((crumb, index) => (
                <Fragment key={crumb.label}>
                  {'href' in crumb && crumb.href ? (
                    <Link href={crumb.href}>{crumb.label}</Link>
                  ) : (
                    <span aria-current="page">{crumb.label}</span>
                  )}
                  {index < crumbs.length - 1 ? (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M9 5l7 7-7 7" />
                    </svg>
                  ) : null}
                </Fragment>
              ))}
            </nav>
            <div className="sgn-topbar-right">
              <LanguageSwitch locale={locale} />
              {employee ? (
                <UserMenu locale={locale} employee={employee} />
              ) : null}
            </div>
          </header>
          <main
            className="sgn-content"
            data-layout={
              pathname === '/properties' || /^\/people\/[^/]+$/.test(pathname)
                ? 'wide'
                : pathname === '/properties/new' || pathname === '/profile'
                  ? 'form'
                  : 'default'
            }
            id="main-content"
            tabIndex={-1}
          >
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
