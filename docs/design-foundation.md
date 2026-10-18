# Canonical authentication design foundation

Ticket #50 establishes the Saigon New House authentication design foundation —
tokens, shared shell and controls, the original mark and an isolated review
preview — so the sign-in (#52) and password-recovery (#51) refactors consume one
project-owned visual baseline instead of a workstation-specific design folder.

## Source of truth and provenance

| Artifact | Location | Provenance |
| --- | --- | --- |
| Final authentication prototype | `docs/design/sgn-auth.reference.html` | Byte-identical copy of `sgn-auth.html` from the Open Design package `ad7d760b-42fb-4e25-9c79-836e5fc914d5`. SHA-256 `4ab9410fbaeeeffaf85eaa23a4f2b174d63d05363d0d2e60cef4024da337ad9d`. |
| Brand mark | `public/brand/logo.png` | Byte-identical copy of the package's `assets/logo.png` (994×853, opaque white canvas). SHA-256 `032eb24b40928278deed3d495902e1cb7b42d3be667e818810a9aeadc37e3767`. Never recoloured, cropped or given a decorative shadow; mounted on a white tile. |
| Tokens and rules | `src/app/sgn-auth.css` | Token names, values and roles copied from the prototype's `:root` block and `colors_and_type.css`. |

Where the prototype and any earlier screenshot disagree, **the final prototype
wins**. The prototype still simulates sign-in success and reset timers; those are
review-only and are not reproduced in the application.

## Tokens

Defined on the `.sgn-auth` shell (never on `:root`, so they cannot leak into the
inventory, property, maintenance or file surfaces that reuse the same generic
names such as `--muted` and `--danger`).

| Role | Token | Value |
| --- | --- | --- |
| Page canvas | `--bg` | `#f3f5f4` |
| Surfaces, inputs, logo tile | `--surface` | `#ffffff` |
| Quiet control fill | `--surface-warm` | `#eef2f1` |
| Ink | `--fg` | `#172a33` |
| Field labels, secondary ink | `--fg-2` | `#2c3f49` |
| Leads, help, placeholders | `--muted` | `#5d6f68` |
| Hairlines | `--border` / `--border-soft` | `#d5dbd8` / `#e6eae8` |
| Input boundary | `--field-border` | `#85938e` |
| Accent | `--accent` | `#176c58` |
| Accent text on fill | `--accent-on` | `#ffffff` |
| Brand rail | `--brand-deep` | `color-mix(accent, black 58%)` |
| Success / warn / danger | `--success` / `--warn` / `--danger` | `#15803d` / `#b45309` / `#b91c1c` |
| Focus ring | `--focus-ring` | `0 0 0 4px` at 24% accent |
| Selected language pill | `--shadow-raise` | `0 1px 2px` at 8% ink (the only elevation) |

State tints (`--success-soft`, `--warn-soft`, `--danger-soft`), the rail ink
variants, radii (`--radius-sm|md|lg|pill`), the 4 px space scale, motion
(`--motion-fast`, `--ease-standard`) and layout tokens (`--form-max: 452px`,
`--rail-w`, `--logo-size: 56px`, `--control-h: 52px`) match the prototype exactly.

## Typography and loading

| Role | Family | Weights | Subset |
| --- | --- | --- | --- |
| Display / wordmark | Oswald | 400/500/600 | latin, latin-ext, vietnamese |
| Body / labels / buttons | Inter | 400/500/600 | latin, latin-ext, vietnamese |
| Mono labels | IBM Plex Mono | 400/500 | latin, latin-ext, vietnamese |

The prototype loads these three families from a Google Fonts `<link>`. This
project binds the same families, weights and subsets to woff2 files vendored in
`src/app/fonts` through `next/font/local` in `src/app/fonts.ts`, so the build
fetches nothing from Google and `src/app/layout.tsx` only applies the resulting
variable classes. The token names (`--font-display`, `--font-body`, `--font-mono`)
stay the contract; `next/font` appends a `"<family> Fallback"` entry to the
computed `font-family` list (a size-adjusted fallback used only before the web
font loads), so rendered glyphs are identical even though the computed
`font-family` string differs.

## Layout contract

- One breakpoint at **1040 px**. Below it the rail collapses to a compact header
  (`--logo-size: 42px`) keeping the mark and wordmark, dropping the statement and
  meta line. Above it the rail is sticky and full-height at `--rail-w`
  (`minmax(340px, 42%)`).
- The form column is `width: 100%; max-width: var(--form-max)` (452 px), centred
  in the panel.
- Controls are `--control-h` (52 px) tall with ≥44 px hit areas; the logo tile is
  56 px (42 px compact) with ≈11% inner padding.
- Rail top inset equals the panel bar's top padding so the mark sits level with
  the language row.

## Shared pieces

| File | Provides |
| --- | --- |
| `src/app/sgn-auth.css` | Canonical tokens and `sgn-`prefixed, `.sgn-auth`-scoped component styles. Element resets use `:where()` so they never outrank the component classes. |
| `src/features/employees/auth-shell.tsx` | `AuthShell` — brand rail, panel bar, centred form column and footer. |
| `src/features/employees/auth-ui.tsx` | `LanguageSwitch`, `TextField`, `PasswordField` (reveal), `PasswordStrength`, `Stepper`, `StatusAlert`, `FieldError`, `buttonClass`. |
| `src/features/employees/password-policy.ts` | Pure new-password rules, levels and verdict keys. |

## Isolated review preview

`/design/auth-preview` renders the shell compositions and every shared control
state in VI/default and EN. It is review-only: it performs no authentication,
collects no credentials and simulates no reset link. It is not covered by the
`proxy` middleware matcher, so it renders without Supabase configuration and is
never a production workflow.

## Visual verification

`scripts/auth-visual-compare.mjs` drives headless Chrome over CDP (no extra
dependencies) to capture the preserved prototype and the running application at
the same viewports (375, 1039, 1040, 1440 px) and compare the computed geometry,
typography, colour, borders and radii of the shared controls. Results are in
[testing.md](testing.md#executed-canonical-authentication-visual-comparison).

## Boundaries

Scope is authentication and its isolated preview only. The adopted stylesheet is
scoped to `.sgn-auth`; the inventory, property-detail, maintenance, file and
readiness surfaces keep the `globals.css` presentation they had before this
foundation.
