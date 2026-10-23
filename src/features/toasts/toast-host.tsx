'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { messages, type Locale } from '@/i18n/messages';
import {
  dismissToast,
  expireToasts,
  pushToast,
  toastFor,
  type SaveOutcome,
  type Toast,
  type ToastTone,
} from './toast-state';

type Notify = (outcome: SaveOutcome) => void;

const ToastContext = createContext<Notify | null>(null);

// A surface rendered outside the shell has no queue to reach: it still saves, it just does
// not confirm twice.
const noNotify: Notify = () => {};

export function useToast(): Notify {
  return useContext(ToastContext) ?? noNotify;
}

const ICONS: Record<ToastTone, ReactNode> = {
  success: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12.5 2.7 2.7L16 9.5" />
    </>
  ),
  danger: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>
  ),
  neutral: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
};

function ToastList({
  locale,
  toasts,
  onDismiss,
}: {
  locale: Locale;
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  const text = messages[locale];
  // An always-present polite live region: the confirmation is heard without interrupting, and
  // nothing here is ever focused, so the page beneath keeps the keyboard where it was.
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div className="toast" data-tone={toast.tone} key={toast.id}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {ICONS[toast.tone]}
          </svg>
          <span>{toast.message}</span>
          <button
            type="button"
            className="toast-dismiss"
            aria-label={text.toastDismiss}
            onClick={() => onDismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function ToastProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback<Notify>((outcome) => {
    setToasts((list) =>
      pushToast(list, toastFor(outcome, crypto.randomUUID(), Date.now())),
    );
  }, []);
  // One timer for the soonest expiry; the queue changing re-arms it.
  useEffect(() => {
    if (!toasts.length) return undefined;
    const soonest = Math.min(...toasts.map((toast) => toast.expiresAt));
    const timer = setTimeout(
      () => setToasts((list) => expireToasts(list, Date.now())),
      Math.max(0, soonest - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [toasts]);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <ToastList
        locale={locale}
        toasts={toasts}
        onDismiss={(id) => setToasts((list) => dismissToast(list, id))}
      />
    </ToastContext.Provider>
  );
}
