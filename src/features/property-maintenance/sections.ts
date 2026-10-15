// The Edit-facts dialog separates the record's three concerns: its own facts, its addresses
// and its contacts. Address content lives only in the address section, so the page's own
// address panel is not repeated a second time inside the dialog.
export const SECTIONS = ['property', 'address', 'contact'] as const;
export type Section = (typeof SECTIONS)[number];
export const DEFAULT_SECTION: Section = 'property';
// The Edit-facts dialog switches its section chooser from the tab strip to a dropdown at
// the shell's narrow breakpoint.
export const NARROW_SECTIONS_QUERY = '(max-width: 720px)';
// Roving tabindex: the arrow keys move both focus and selection, and wrap at both ends.
// Any other key returns null so the caller leaves the default alone.
export function nextSection(current: Section, key: string): Section | null {
  const index = SECTIONS.indexOf(current);
  const next =
    key === 'ArrowRight'
      ? SECTIONS[(index + 1) % SECTIONS.length]
      : key === 'ArrowLeft'
        ? SECTIONS[(index + SECTIONS.length - 1) % SECTIONS.length]
        : key === 'Home'
          ? SECTIONS[0]
          : key === 'End'
            ? SECTIONS[SECTIONS.length - 1]
            : null;
  return next ?? null;
}
