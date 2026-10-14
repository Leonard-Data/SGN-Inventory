// Exact-viewport visual comparison for the canonical authentication design
// (tickets #50–#52). Drives headless Chrome over CDP (no extra dependencies:
// Node's global WebSocket + fetch) to capture the preserved reference prototype
// and the running application at the same viewport sizes and heights, and to
// diff the computed geometry, typography and colour of the shared controls.
//
// Usage:
//   node scripts/auth-visual-compare.mjs
// Environment:
//   BASE_URL         running app origin (default http://127.0.0.1:3210)
//   REFERENCE_HTML   preserved prototype path (default docs/design/sgn-auth.reference.html)
//   OUT_DIR          evidence directory (default OS temp / sgn-auth-evidence)
//   CHROME_BIN       Chrome executable
//   WIDTHS           comma list (default 375,1040,1039,1440)
//   HEIGHT           viewport height (default 900; unused when AUTOSIZE=1)
//   AUTOSIZE         set 1 to capture the full viewport height per surface
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3210';
const REFERENCE = path.resolve(
  root,
  process.env.REFERENCE_HTML ?? 'docs/design/sgn-auth.reference.html',
);
const OUT = process.env.OUT_DIR ?? path.join(tmpdir(), 'sgn-auth-evidence');
// 'auth' compares the canonical authentication surfaces (default). 'applied'
// compares the shared application surfaces — shell, inventory cards, panels,
// controls — against the design package's own applied reference, which must be
// named through REFERENCE_HTML because it lives outside this repository.
const PROFILE = process.env.PROFILE ?? 'auth';
if (PROFILE === 'applied' && !process.env.REFERENCE_HTML) {
  console.error(
    'PROFILE=applied needs REFERENCE_HTML pointing at the design package applied reference.',
  );
  process.exit(2);
}
const WIDTHS = (process.env.WIDTHS ?? '375,1040,1039,1440')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter(Boolean);
const HEIGHT = Number(process.env.HEIGHT ?? 900);
const AUTOSIZE = process.env.AUTOSIZE === '1';
const CHROME =
  process.env.CHROME_BIN ??
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((candidate) => existsSync(candidate));

if (!CHROME) {
  console.error('Chrome executable not found; set CHROME_BIN.');
  process.exit(2);
}

const refUrl = pathToFileURL(REFERENCE).href;

// Selectors outside the switching card (shared by both reference views).
const refOutside = {
  shell: '.shell',
  rail: '.brand-rail',
  tile: '.logo-tile',
  panel: '.auth-panel',
  langBar: '.lang-switch',
  langBtn: '.lang-btn[aria-pressed="true"]',
  foot: '.panel-foot',
  skip: null,
};
// Selectors that must be scoped to the reference's visible view element.
const refInside = {
  card: '.auth-card',
  h1: 'h1',
  input: '.input',
  btn: '.btn-primary',
  secondary: '.btn-secondary',
  eyebrow: '.eyebrow',
  lead: '.lead',
  field: '.field',
  error: '.field-error',
  check: '.check',
  link: '.link',
  stepper: '.stepper',
  step: '.step',
  strength: '.strength',
  rule: '.rule',
};
const appSelectors = {
  shell: '.sgn-auth',
  rail: '.brand-rail',
  tile: '.logo-tile',
  panel: '.auth-panel',
  card: '.auth-card',
  h1: '.auth-card h1',
  input: '.input',
  btn: '.btn-primary',
  secondary: '.btn-secondary',
  eyebrow: '.auth-card .eyebrow',
  lead: '.auth-card .lead',
  field: '.field',
  error: '.field-error',
  check: '.check',
  link: '.link',
  langBar: '.lang-switch',
  langBtn: '.lang-btn[aria-pressed="true"]',
  stepper: '.stepper',
  step: '.step',
  strength: '.strength',
  rule: '.rule',
  foot: '.panel-foot',
  skip: '.sgn-skip',
};

// Both sides of the applied comparison use the same class vocabulary (that is
// the point of the design system), so one selector map serves the reference and
// the application. Only style properties are compared here: the two sides carry
// different fixture content, so box sizes are not a defect signal, while a
// wrong colour, radius, spacing, type ramp or grid template is.
const appliedSelectors = {
  shell: '.sgn-app',
  sidebar: '.sgn-sidebar',
  lockup: '.sgn-lockup',
  navItem: '.sgn-nav-item',
  topbar: '.sgn-topbar',
  langBar: '.lang-switch',
  langBtn: '.lang-btn[aria-pressed="true"]',
  content: '.sgn-content',
  pageIntro: '.page-intro h1',
  eyebrow: '.eyebrow',
  search: '.search',
  searchBtn: '.search-btn',
  card: '.property-card',
  cover: '.property-card .cover',
  plate: '.plate-sheet',
  badge: '.badge[data-tone="neutral"]',
  panel: '.panel',
  panelHead: '.panel-head h2',
  btn: '.btn-primary',
  secondary: '.btn-secondary',
  table: '.data-table',
  tableHead: '.data-table th',
  pagination: '.pagination',
  state: '.state-panel',
};

const appliedMetricsExpression = `(sel) => {
  const q = (s) => (s ? document.querySelector(s) : null);
  const pick = (el, props) => {
    const c = el ? getComputedStyle(el) : null;
    if (!c) return null;
    const o = {};
    for (const p of props) o[p] = c.getPropertyValue(p);
    return o;
  };
  const TEXT = ['font-family','font-size','font-weight','line-height','letter-spacing','color'];
  return {
    fonts: document.fonts.status,
    shell: pick(q(sel.shell), ['display','grid-template-columns','background-color','min-height']),
    sidebar: pick(q(sel.sidebar), ['background-color','color','padding','overflow-y']),
    lockup: pick(q(sel.lockup), ['display','align-items','gap','padding']),
    navItem: pick(q(sel.navItem), ['min-height','border-radius','font-size','font-weight','color','background-color','padding']),
    topbar: pick(q(sel.topbar), ['min-height','padding-left','padding-right','border-bottom-color','background-color','position']),
    langBar: pick(q(sel.langBar), ['background-color','border-radius','border-color','padding']),
    langBtn: pick(q(sel.langBtn), ['min-height','border-radius','font-size','font-weight','color','background-color']),
    content: pick(q(sel.content), ['max-width','padding-top','padding-left','padding-right','margin-left','margin-right']),
    pageIntro: pick(q(sel.pageIntro), TEXT.concat(['margin-top'])),
    eyebrow: pick(q(sel.eyebrow), ['font-family','font-size','letter-spacing','text-transform','color']),
    search: pick(q(sel.search), ['display','min-height','border-color','border-radius','background-color','padding']),
    searchBtn: pick(q(sel.searchBtn), ['min-height','border-radius','background-color','color','font-weight']),
    card: pick(q(sel.card), ['display','border-radius','border-color','background-color','overflow']),
    cover: pick(q(sel.cover), ['aspect-ratio','background-color','border-bottom-color']),
    plate: pick(q(sel.plate), ['background-color','border-radius','width','height']),
    badge: pick(q(sel.badge), ['display','min-height','border-radius','font-size','font-weight','letter-spacing','color','border-color','padding']),
    panel: pick(q(sel.panel), ['background-color','border-color','border-radius','padding','box-shadow']),
    panelHead: pick(q(sel.panelHead), TEXT),
    btn: pick(q(sel.btn), ['min-height','padding-left','border-radius','background-color','color','font-size','font-weight']),
    secondary: pick(q(sel.secondary), ['min-height','border-color','background-color','color']),
    table: pick(q(sel.table), ['width','border-collapse','font-size']),
    tableHead: pick(q(sel.tableHead), ['font-family','font-size','letter-spacing','text-transform','color']),
    pagination: pick(q(sel.pagination), ['display','align-items','gap','margin-top']),
    state: pick(q(sel.state), ['background-color','border-color','border-radius','padding','text-align']),
  };
}`;

// Keys resolved against the view element itself; the rest resolve against the
// visible step form inside that view.
const refScopeKeys = new Set([
  'card',
  'h1',
  'eyebrow',
  'lead',
  'stepper',
  'step',
]);

function refSelectors(scope, formScope) {
  const out = { ...refOutside };
  for (const [key, selector] of Object.entries(refInside)) {
    if (key === 'card') out[key] = scope;
    else if (refScopeKeys.has(key)) out[key] = `${scope} ${selector}`;
    else out[key] = `${formScope} ${selector}`;
  }
  return out;
}

const metricsExpression = `(sel) => {
  const q = (s) => (s ? document.querySelector(s) : null);
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const pick = (el, props) => { const c = cs(el); if (!c) return null; const o = {}; for (const p of props) o[p] = c.getPropertyValue(p); return o; };
  const TEXT = ['font-family','font-size','font-weight','line-height','letter-spacing','color'];
  return {
    fonts: document.fonts.status,
    dpr: window.devicePixelRatio,
    shell: { box: box(q(sel.shell)), style: pick(q(sel.shell), ['grid-template-columns','background-color','display']) },
    rail: { box: box(q(sel.rail)), style: pick(q(sel.rail), ['background-color','color','padding']) },
    tile: { box: box(q(sel.tile)), style: pick(q(sel.tile), ['background-color','border-radius','padding']) },
    panel: { box: box(q(sel.panel)), style: pick(q(sel.panel), ['background-color']) },
    card: { box: box(q(sel.card)), style: pick(q(sel.card), ['max-width','width']) },
    h1: pick(q(sel.h1), TEXT.concat(['margin-top'])),
    eyebrow: pick(q(sel.eyebrow), ['font-family','font-size','letter-spacing','color','text-transform']),
    lead: pick(q(sel.lead), ['font-size','line-height','color','max-width','margin-top']),
    input: { box: box(q(sel.input)), style: pick(q(sel.input), ['min-height','border-color','border-radius','font-size','padding-left','background-color','color']) },
    btn: { box: box(q(sel.btn)), style: pick(q(sel.btn), ['background-color','color','border-radius','font-size','font-weight','min-height','padding-left']) },
    secondary: { box: box(q(sel.secondary)), style: pick(q(sel.secondary), ['background-color','color','border-color','min-height']) },
    langBar: { box: box(q(sel.langBar)), style: pick(q(sel.langBar), ['background-color','border-radius','border-color','padding']) },
    langBtn: { box: box(q(sel.langBtn)), style: pick(q(sel.langBtn), ['min-height','color','font-size','font-weight','background-color']) },
    check: { box: box(q(sel.check)), style: pick(q(sel.check), ['min-height','font-size','color']) },
    link: { box: box(q(sel.link)), style: pick(q(sel.link), ['color','font-size','text-underline-offset','text-decoration-thickness','min-height']) },
    field: pick(q(sel.field), ['display','row-gap']),
    error: pick(q(sel.error), ['font-size','color']),
    stepper: pick(q(sel.stepper), ['grid-template-columns','margin-bottom']),
    step: pick(q(sel.step), ['border-top-width','border-top-color','font-size','color','letter-spacing','text-transform']),
    strength: pick(q(sel.strength), ['display','row-gap']),
    rule: pick(q(sel.rule), ['font-size','color']),
    foot: { box: box(q(sel.foot)), style: pick(q(sel.foot), ['font-family','font-size','color','border-top-color','letter-spacing','text-transform','padding']) },
    skip: box(q(sel.skip)),
  };
}`;

const authSurfaces = [
  {
    name: 'sign-in',
    appPath: '/login',
    refHash: '',
    refScope: '#view-login',
    refFormScope: '#login-form',
    refSteps: ['lang-vi'],
    appCookies: [],
  },
  {
    name: 'sign-in-en',
    appPath: '/login?lang=en',
    refHash: '',
    refScope: '#view-login',
    refFormScope: '#login-form',
    refSteps: ['lang-en'],
    appCookies: [{ name: 'sgn-locale', value: 'en', url: BASE + '/login' }],
  },
  {
    name: 'recover-request',
    appPath: '/recover',
    refHash: '#/change-password',
    refScope: '#view-change',
    refFormScope: '#verify-form',
    refSteps: ['lang-vi'],
    appCookies: [],
  },
  {
    name: 'recover-password',
    appPath: '/reset-password',
    refHash: '#/change-password',
    refScope: '#view-change',
    refFormScope: '#reset-form',
    refSteps: ['lang-vi', 'advance'],
    appCookies: [
      {
        name: 'sgn-recovery',
        value: 'local-visual-check',
        url: BASE + '/reset-password',
      },
    ],
  },
  {
    name: 'recover-password-en',
    appPath: '/reset-password',
    refHash: '#/change-password',
    refScope: '#view-change',
    refFormScope: '#reset-form',
    refSteps: ['lang-en', 'advance'],
    appCookies: [
      {
        name: 'sgn-recovery',
        value: 'local-visual-check',
        url: BASE + '/reset-password',
      },
      { name: 'sgn-locale', value: 'en', url: BASE + '/reset-password' },
    ],
  },
];

// The applied profile compares the shared surfaces at one width-independent
// route. The review route renders the shell, the inventory composition and the
// record panels from fixtures, so it needs no session and no database.
const appliedSurfaces = [
  {
    name: 'applied',
    appPath: '/design/app-preview',
    refUrl: refUrl,
    refHash: '',
    refScope: 'body',
    refFormScope: 'body',
    refSteps: [],
    appCookies: [],
  },
];

const surfaces = PROFILE === 'applied' ? appliedSurfaces : authSurfaces;

async function runRefStep(send, step) {
  if (step === 'lang-vi' || step === 'lang-en') {
    const language = step.slice(5);
    await send('Runtime.evaluate', {
      expression: `(() => { const b = document.querySelector('.lang-btn[data-lang="${language}"]'); if (b) b.click(); return true; })()`,
    });
    await delay(150);
  }
  if (step === 'advance') {
    await send('Runtime.evaluate', {
      expression: `(() => {
        const email = document.querySelector('#verify-email');
        if (email) email.value = 'visual@check.local';
        const button = document.querySelector('#verify-form button[type="submit"]');
        if (button) button.click();
        return true;
      })()`,
    });
    await delay(1400);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectCdp(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((target) => target.type === 'page');
  if (!page) throw new Error('no page target');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method) {
      for (const listener of listeners) listener(message);
    }
  });
  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  function once(method, timeout = 15000) {
    return new Promise((resolve) => {
      const listener = (message) => {
        if (message.method === method) {
          listeners.delete(listener);
          resolve(message.params);
        }
      };
      listeners.add(listener);
      setTimeout(() => {
        listeners.delete(listener);
        resolve(null);
      }, timeout);
    });
  }
  return { send, once, socket };
}

async function launchChrome() {
  const profile = path.join(tmpdir(), `sgn-chrome-${Date.now()}`);
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (existsSync(portFile)) {
      const contents = await readFile(portFile, 'utf8');
      const port = Number(contents.split(/\r?\n/)[0]);
      if (port) return { child, port, profile };
    }
    await delay(150);
  }
  throw new Error('Chrome did not start');
}

function flatten(value, prefix = '', out = {}) {
  if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      flatten(inner, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out[prefix] = value;
  }
  return out;
}

function diffMetrics(ref, app) {
  const flatRef = flatten(ref);
  const flatApp = flatten(app);
  const keys = new Set([...Object.keys(flatRef), ...Object.keys(flatApp)]);
  const differences = [];
  for (const key of [...keys].sort()) {
    const a = flatRef[key];
    const b = flatApp[key];
    if (a === b) continue;
    // Colour values may be expressed as oklab() vs rgb(); compare by rendering.
    differences.push({ key, ref: a, app: b });
  }
  return differences;
}

const report = {
  base: BASE,
  reference: REFERENCE,
  widths: WIDTHS,
  height: HEIGHT,
  captures: [],
};

const { child, port } = await launchChrome();
try {
  const { send, once, socket } = await connectCdp(port);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  for (const width of WIDTHS) {
    for (const surface of surfaces) {
      const height = AUTOSIZE ? 1000 : HEIGHT;
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });

      for (const variant of ['ref', 'app']) {
        await send('Network.clearBrowserCookies');
        if (variant === 'app') {
          for (const cookie of surface.appCookies) {
            await send('Network.setCookie', {
              name: cookie.name,
              value: cookie.value,
              url: cookie.url,
              path: '/',
            });
          }
        }
        const url =
          variant === 'ref'
            ? (surface.refUrl ?? refUrl) + (surface.refHash ?? '')
            : BASE + surface.appPath;
        const loaded = once('Page.loadEventFired');
        await send('Page.navigate', { url });
        await loaded;
        if (variant === 'ref') {
          for (const step of surface.refSteps) await runRefStep(send, step);
        }
        await send('Runtime.evaluate', {
          expression:
            '(async () => { await document.fonts.ready; return document.fonts.status; })()',
          awaitPromise: true,
        });
        await delay(200);
        const expression =
          PROFILE === 'applied' ? appliedMetricsExpression : metricsExpression;
        const selectors =
          PROFILE === 'applied'
            ? appliedSelectors
            : variant === 'ref'
              ? refSelectors(surface.refScope, surface.refFormScope)
              : appSelectors;
        const measured = await send('Runtime.evaluate', {
          expression: `(${expression})(${JSON.stringify(selectors)})`,
          returnByValue: true,
        });
        const metrics = measured.result.value;
        const shot = await send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: AUTOSIZE,
        });
        const file = path.join(OUT, `${surface.name}-${variant}-${width}.png`);
        await writeFile(file, Buffer.from(shot.data, 'base64'));
        report.captures.push({
          width,
          surface: surface.name,
          variant,
          file,
          metrics,
        });
      }
    }
  }
  socket.close();
} finally {
  child.kill();
}

await mkdir(OUT, { recursive: true });
await writeFile(
  path.join(OUT, 'metrics.json'),
  JSON.stringify(report, null, 2),
  'utf8',
);

// Print a per-surface diff so unintended layout/type/colour differences are visible.
for (const width of WIDTHS) {
  for (const surface of surfaces) {
    const ref = report.captures.find(
      (c) =>
        c.width === width && c.surface === surface.name && c.variant === 'ref',
    );
    const app = report.captures.find(
      (c) =>
        c.width === width && c.surface === surface.name && c.variant === 'app',
    );
    const differences = diffMetrics(ref.metrics, app.metrics).filter(
      (entry) => entry.ref !== null && entry.app !== null,
    );
    console.log(
      `\n== ${surface.name} @${width}px == (${differences.length} diffs)`,
    );
    for (const entry of differences) {
      console.log(
        `  ${entry.key}: ref=${JSON.stringify(entry.ref)} app=${JSON.stringify(entry.app)}`,
      );
    }
  }
}
console.log(`\nEvidence written to ${OUT}`);
