'use client';
import { useEffect, useRef, type ReactNode } from 'react';

// The dialog owns the only heading and the only border on the surface: the embedded section is
// flattened by `.sgn-dialog-body > .panel` in sgn-app.css, so every action dialog opens with one
// visible title in the right place instead of an empty band.
export function DetailActionDialog({
  title,
  closeLabel,
  children,
  open,
  onClose,
  size = 'wide',
}: {
  title: string;
  closeLabel: string;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  size?: 'default' | 'wide';
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="sgn-dialog"
      data-size={size}
      onClose={onClose}
      onCancel={onClose}
      aria-label={title}
    >
      <div className="sgn-dialog-panel">
        <div className="sgn-dialog-head">
          <h2>{title}</h2>
          <button
            className="sgn-dialog-close"
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
          >
            ×
          </button>
        </div>
        <div className="sgn-dialog-body">{open ? children : null}</div>
      </div>
    </dialog>
  );
}
