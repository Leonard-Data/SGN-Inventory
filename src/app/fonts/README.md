# Vendored fonts

`src/app/fonts.ts` loads these files with `next/font/local`. They are the exact
woff2 files that `next/font/google` used to download while building, so the
production build no longer contacts `fonts.googleapis.com` and every build
renders identical bytes.

Retrieved 2026-10-18 from the Google Fonts CSS API, requested with the same
browser user agent `next/font/google` uses (`Chrome/104.0.0.0`), which is what
selects the woff2 responses:

| File                                                     | Family        | Weights            | Google Fonts version |
| -------------------------------------------------------- | ------------- | ------------------ | -------------------- |
| `oswald-{vietnamese,latin-ext,latin}.woff2`              | Oswald        | 400–600 (variable) | v57                  |
| `inter-{vietnamese,latin-ext,latin}.woff2`               | Inter         | 400–600 (variable) | v20                  |
| `plex-mono-{vietnamese,latin-ext,latin}-{400,500}.woff2` | IBM Plex Mono | 400, 500 (static)  | v20                  |

Each family has one file per subset. Google served one and the same variable
file for the 400, 500 and 600 faces of Oswald and Inter, so a single file per
subset covers all three weights; IBM Plex Mono is static and ships a file per
weight. The `unicode-range` and `font-family` values in `src/app/fonts.ts` are
copied from the CSS Google returned for these files, as is the declaration
order (`vietnamese`, `latin-ext`, `latin`): where ranges overlap, the last
matching `@font-face` wins.

Subsets: `latin`, `latin-ext` and `vietnamese` cover every character this app's
Vietnamese and English UI can render. The `cyrillic`, `cyrillic-ext` and `greek`
subsets Google's CSS also listed are not vendored because no page can produce
those characters; that was the one part of Google's response left behind.
Extending it means downloading the extra subset files and adding one
`localFont` call per family and subset in `src/app/fonts.ts`.

## Licences

All three families are licensed under the SIL Open Font License 1.1, reproduced
here as `OFL-oswald.txt`, `OFL-inter.txt` and `OFL-ibm-plex-mono.txt`, taken
from <https://github.com/google/fonts> (`ofl/oswald`, `ofl/inter`,
`ofl/ibmplexmono`). The licence text travels with the files; do not remove it.
