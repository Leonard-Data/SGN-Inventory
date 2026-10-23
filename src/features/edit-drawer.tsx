'use client';
import { useEffect, type ReactNode } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { DetailActionDialog } from '@/features/properties/detail-dialog';

// Both directory editors share the native modal, close guard and focus return.
export function EditDrawer({
  title,
  locale,
  dirty,
  busy,
  opener,
  onClose,
  children,
}: {
  title: string;
  locale: Locale;
  dirty: boolean;
  busy: boolean;
  opener: HTMLElement | null;
  onClose: () => void;
  children: (requestClose: () => void) => ReactNode;
}) {
  const text = messages[locale];
  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, busy]);
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus();
      });
    },
    [opener],
  );
  const requestClose = () => {
    if (!busy && (!dirty || window.confirm(text.discardChanges))) onClose();
  };
  return (
    <DetailActionDialog
      size="drawer"
      title={title}
      closeLabel={text.cancel}
      bodyClassName="editor-body"
      open
      onClose={requestClose}
    >
      {children(requestClose)}
    </DetailActionDialog>
  );
}
