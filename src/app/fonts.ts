import localFont from 'next/font/local';

// These local families replace the three `next/font/google` calls: that loader
// downloaded this CSS and these woff2 files from fonts.googleapis.com on every
// production build, so a runner without reachable Google Fonts failed the
// release. Families, weights, styles, subsets and display behaviour are
// unchanged, so no stylesheet or component had to change; ./fonts/README.md
// records the source, version and licence of each file.
//
// One declaration group per subset: `next/font/local` applies `declarations` to
// the whole call, so the unicode-range needs its own call. All groups of a
// family share an explicit `font-family`, because the browser selects a font
// face per character across every face of that family. next/font only accepts
// literal arguments, so the ranges repeat below.
//
// Oswald and Inter are variable fonts and Google served one file for their 400,
// 500 and 600 faces, so a single file carries the whole 400-600 range - every
// weight the stylesheets ask for. IBM Plex Mono is static: one file per weight.
// Subset groups are declared vietnamese, latin-ext, latin: Google's own order,
// where overlapping ranges make the last matching face win. Only the latin and
// vietnamese subsets are preloaded, as before.

const displayVietnamese = localFont({
  src: [
    {
      path: './fonts/oswald-vietnamese.woff2',
      weight: '400 600',
      style: 'normal',
    },
  ],
  variable: '--sgn-font-display',
  display: 'swap',
  declarations: [
    { prop: 'font-family', value: 'Oswald' },
    {
      prop: 'unicode-range',
      value:
        'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
    },
  ],
});
const displayLatinExt = localFont({
  src: [
    {
      path: './fonts/oswald-latin-ext.woff2',
      weight: '400 600',
      style: 'normal',
    },
  ],
  variable: '--sgn-font-display',
  display: 'swap',
  preload: false,
  declarations: [
    { prop: 'font-family', value: 'Oswald' },
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
});
const displayLatin = localFont({
  src: [
    { path: './fonts/oswald-latin.woff2', weight: '400 600', style: 'normal' },
  ],
  variable: '--sgn-font-display',
  display: 'swap',
  declarations: [
    { prop: 'font-family', value: 'Oswald' },
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const bodyVietnamese = localFont({
  src: [
    {
      path: './fonts/inter-vietnamese.woff2',
      weight: '400 600',
      style: 'normal',
    },
  ],
  variable: '--sgn-font-body',
  display: 'swap',
  declarations: [
    { prop: 'font-family', value: 'Inter' },
    {
      prop: 'unicode-range',
      value:
        'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
    },
  ],
});
const bodyLatinExt = localFont({
  src: [
    {
      path: './fonts/inter-latin-ext.woff2',
      weight: '400 600',
      style: 'normal',
    },
  ],
  variable: '--sgn-font-body',
  display: 'swap',
  preload: false,
  declarations: [
    { prop: 'font-family', value: 'Inter' },
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
});
const bodyLatin = localFont({
  src: [
    { path: './fonts/inter-latin.woff2', weight: '400 600', style: 'normal' },
  ],
  variable: '--sgn-font-body',
  display: 'swap',
  declarations: [
    { prop: 'font-family', value: 'Inter' },
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const monoVietnamese = localFont({
  src: [
    {
      path: './fonts/plex-mono-vietnamese-400.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/plex-mono-vietnamese-500.woff2',
      weight: '500',
      style: 'normal',
    },
  ],
  variable: '--sgn-font-mono',
  display: 'swap',
  declarations: [
    { prop: 'font-family', value: 'IBM Plex Mono' },
    {
      prop: 'unicode-range',
      value:
        'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
    },
  ],
});
const monoLatinExt = localFont({
  src: [
    {
      path: './fonts/plex-mono-latin-ext-400.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/plex-mono-latin-ext-500.woff2',
      weight: '500',
      style: 'normal',
    },
  ],
  variable: '--sgn-font-mono',
  display: 'swap',
  preload: false,
  declarations: [
    { prop: 'font-family', value: 'IBM Plex Mono' },
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
    },
  ],
});
const monoLatin = localFont({
  src: [
    {
      path: './fonts/plex-mono-latin-400.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/plex-mono-latin-500.woff2',
      weight: '500',
      style: 'normal',
    },
  ],
  variable: '--sgn-font-mono',
  display: 'swap',
  declarations: [
    { prop: 'font-family', value: 'IBM Plex Mono' },
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

// Every group contributes the same variable declaration for its family, so the
// document only needs these classes either way; joining them keeps the layout's
// className readable and marks each font call as used.
export const fontVariables = [
  displayVietnamese.variable,
  displayLatinExt.variable,
  displayLatin.variable,
  bodyVietnamese.variable,
  bodyLatinExt.variable,
  bodyLatin.variable,
  monoVietnamese.variable,
  monoLatinExt.variable,
  monoLatin.variable,
].join(' ');
