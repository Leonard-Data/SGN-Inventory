'use client';
import type { ReactNode } from 'react';

// One authored icon system for the icon-only controls on the record surfaces: a single
// 1.7-stroke set drawn on the 24px grid the package already uses. Each control carries its
// localized label as both the accessible name and the native tooltip.
const paths: Record<string, ReactNode> = {
  open: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 19h14" />
    </>
  ),
  tag: (
    <>
      <path d="M20.6 12.6 12 4H4v8l8.6 8.6a2 2 0 0 0 2.8 0l5.2-5.2a2 2 0 0 0 0-2.8z" />
      <circle cx="8" cy="8" r="1.2" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="m14 5 4 4" />
    </>
  ),
  remove: (
    <>
      <path d="M5 7h14" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M7 7v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7" />
      <path d="M11 11v6M13 11v6" />
    </>
  ),
  moderate: (
    <>
      <path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z" />
      <path d="M12 9v4M12 16h.01" />
    </>
  ),
  imagePlus: (
    <>
      <path d="M4 5h16v14H4z" />
      <path d="M4 15.5 9 10l4.5 4.5L16 12l4 4" />
      <path d="M17.5 4.5V8M15.8 6.2h3.4" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </>
  ),
  previous: (
    <>
      <path d="M14 6l-6 6 6 6" />
      <path d="M19 6v12" />
    </>
  ),
  next: (
    <>
      <path d="m10 6 6 6-6 6" />
      <path d="M5 6v12" />
    </>
  ),
};

export type IconName = keyof typeof paths;

export function IconAction({
  name,
  label,
  onClick,
  disabled = false,
  busy = false,
  expanded,
  controls,
}: {
  name: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  expanded?: boolean;
  controls?: string;
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      data-busy={busy ? 'yes' : undefined}
      title={label}
      aria-label={label}
      aria-busy={busy}
      aria-expanded={expanded}
      aria-controls={controls}
      disabled={disabled || busy}
      onClick={onClick}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {paths[name]}
      </svg>
    </button>
  );
}
