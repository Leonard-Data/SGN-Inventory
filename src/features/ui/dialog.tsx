'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { messages, type Locale } from '@/i18n/messages';

// A native modal <dialog>: the platform supplies the focus trap, Escape, the inert
// background and focus restore. The panel vocabulary is the design package's own
// .sgn-dialog set, so a caller composes the dialog rather than restyling it.
// The content mounts only while open, so a moved workflow fetches when it is asked for.
export function Dialog({
  open,
  onClose,
  locale,
  title,
  note,
  size,
  children,
}: {
  open: boolean;
  onClose: () => void;
  locale: Locale;
  title: string;
  note?: string;
  size?: 'wide';
  children: ReactNode;
}) {
  const panel = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  const text = messages[locale];
  return (
    <dialog
      ref={panel}
      className="sgn-dialog"
      data-size={size}
      aria-labelledby={headingId}
      // Escape, the backdrop click and the close control all land here; the opener's own
      // close() re-fires this, which is idempotent.
      onClose={onClose}
      onClick={(event) => {
        // Only the backdrop sits outside the panel box, so only it targets the dialog.
        if (event.target === panel.current) onClose();
      }}
    >
      {open ? (
        <div className="sgn-dialog-panel">
          <div className="sgn-dialog-head">
            <div>
              <h2 id={headingId}>{title}</h2>
              {note ? <p>{note}</p> : null}
            </div>
            <button
              type="button"
              className="sgn-dialog-close"
              onClick={onClose}
              aria-label={text.close}
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div className="sgn-dialog-body">{children}</div>
          <div className="sgn-dialog-foot">
            {note ? <p className="foot-lead">{note}</p> : null}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              {text.close}
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
