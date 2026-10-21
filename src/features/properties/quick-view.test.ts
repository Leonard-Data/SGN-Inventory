import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { messages } from '../../i18n/messages.ts';

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const drawer = source('./property-drawer.tsx');
const dialog = source('./detail-dialog.tsx');
const surfaces = source('../../app/sgn-surfaces.css');
const appLayer = source('../../app/app.css');
const packageLayer = source('../../app/sgn-app.css');

function rule(from: string): string {
  const start = surfaces.indexOf(from);
  assert.ok(start >= 0, `${from} is defined`);
  const body = surfaces.slice(start);
  return body.slice(0, body.indexOf('}'));
}

// The quick view is a side panel, not a dialog centred over the list. A modal <dialog> is centred
// by the browser's own `margin: auto`, so the dialog box itself is pinned to the right edge and
// its backdrop paints nothing: the list stays visible beside the panel, and Escape, the focus trap
// and the focus return stay the platform's own.
test('the quick view opens as a panel at the right edge, not a centred dialog', () => {
  assert.match(drawer, /size="drawer"/);
  assert.match(dialog, /data-size=\{size\}/);
  const panel = rule("dialog.sgn-dialog[data-size='drawer'] {");
  assert.match(panel, /inset: 0 0 0 auto/);
  assert.match(panel, /margin: 0/);
  assert.doesNotMatch(panel, /margin: auto/);
  assert.match(panel, /height: 100dvh/);
  assert.match(panel, /width: min\(540px, 100vw\)/);
  assert.doesNotMatch(surfaces, /100vw - 320px/);
  assert.match(
    surfaces,
    /@media \(max-width: 640px\) \{\s*dialog\.sgn-dialog\[data-size='drawer'\] \{\s*width: 100vw/,
  );
  assert.match(
    rule("dialog.sgn-dialog[data-size='drawer']::backdrop"),
    /background: transparent/,
  );
});

test('the full-record action sits in a persistent footer outside the scrolling body', () => {
  assert.match(drawer, /footer=\{/);
  assert.match(drawer, /heading=\{/);
  assert.match(dialog, /className="sgn-dialog-foot"/);
  assert.ok(
    dialog.indexOf('className="sgn-dialog-foot"') >
      dialog.indexOf('className={`sgn-dialog-body'),
  );
});

test('the panel lists the linked owner contacts, or states that there are none', () => {
  // The names come from the one contact projection that withholds recorded owner phones.
  assert.match(drawer, /contactRows\(detail\.contacts\)/);
  assert.match(drawer, /row\.relation === 'owner'/);
  assert.match(drawer, /<h3 id=\{ownersId\}>\{text\.ownerContact\}<\/h3>/);
  assert.match(drawer, /\{owner\.name \?\? text\.unknown\}/);
  assert.match(drawer, /\{text\.ownerContactMissing\}/);
  // No recorded source phone text is ever read here.
  assert.doesNotMatch(drawer, /raw_phone_text|\.phones/);
});

test('the owner phone is absent while hidden and rendered only after a reveal', () => {
  // The panel holds a value only once the deliberate disclosure has answered.
  const shown = drawer.indexOf('{phone.shown ? (');
  const number = drawer.indexOf('{phone.phone}');
  const mask = drawer.indexOf('{HIDDEN_PHONE}');
  assert.ok(shown > 0 && number > shown && mask > number);
  // The mask is decorative: the control carries the localized label.
  assert.match(
    drawer,
    /<span className="num" aria-hidden="true">\s*\{HIDDEN_PHONE\}/,
  );
  assert.match(
    drawer,
    /aria-pressed=\{phone\.shown\}[\s\S]{0,400}aria-label=\{/,
  );
  // Hiding drops the value instead of masking it, so the number leaves the DOM with it.
  assert.match(drawer, /setDisclosure\(null\)/);
});

test('the panel slides in at a calmer pace than the package default', () => {
  // The drawer states its own duration and easing instead of taking the package's base motion:
  // the panel has to read as sliding in and settling, not as appearing.
  const motion = surfaces.slice(
    surfaces.indexOf('@media (prefers-reduced-motion: no-preference)'),
    surfaces.indexOf('@keyframes sgn-drawer-in'),
  );
  const declared =
    /\.sgn-dialog\[data-size='drawer'\] \.sgn-dialog-panel \{\s*animation: sgn-drawer-in (\d+)ms (cubic-bezier\([^)]*\))/.exec(
      motion,
    );
  assert.ok(declared, 'the drawer states its own duration and easing');
  // 230ms is the package's base motion, which arrived almost instantly.
  assert.ok(
    Number(declared[1]) > 230,
    `the drawer is slower than the 230ms base (${declared[1]}ms)`,
  );
  // A reduced-motion user gets the panel without any movement: the animation lives inside the
  // no-preference query, and the app layer stops anything that would still apply.
  assert.match(
    appLayer,
    /@media \(prefers-reduced-motion: reduce\) \{[^}]*animation-duration: \.01ms !important/,
  );
});

test('the quick attachment is one labelled picker, not a bare file input', () => {
  // The native control stays in the page for the platform's own chooser and keyboard behaviour,
  // but the visible picker is its label: one control, named by what a person reads.
  assert.match(
    drawer,
    /className="quick-upload-input"[\s\S]{0,200}id=\{uploadId\}/,
  );
  assert.match(
    drawer,
    /<label className="quick-upload-picker" htmlFor=\{uploadId\}>/,
  );
  // The chosen file's name is stated, with the catalogue's own words while nothing is chosen.
  assert.match(drawer, /\{selectedFileName \?\? fileText\.noFiles\}/);
  assert.match(
    drawer,
    /\{uploading \? fileText\.uploading : fileText\.selectFiles\}/,
  );
  // Clipped rather than removed, so it still takes focus and opens the chooser while painting
  // nothing, and the focus ring lands on the picker a person can see.
  assert.match(rule('.quick-upload-input {'), /clip-path: inset\(50%\)/);
  assert.match(
    surfaces,
    /\.quick-upload-input:focus-visible \+ \.quick-upload-picker \{[^}]*outline: 2px solid var\(--accent\)/,
  );
});

test('every new label and the reveal control carry both languages', () => {
  const keys = ['ownerContact', 'showOwnerPhone', 'hideOwnerPhone'] as const;
  for (const locale of ['vi', 'en'] as const)
    for (const key of keys)
      assert.ok(
        messages[locale][key].trim().length,
        `${locale}.${key} is missing`,
      );
  assert.notEqual(messages.vi.ownerContact, messages.en.ownerContact);
  assert.notEqual(messages.vi.showOwnerPhone, messages.en.showOwnerPhone);
  assert.notEqual(messages.vi.hideOwnerPhone, messages.en.hideOwnerPhone);
});

// The panel arrives once: one motion, the slide. A shared dialog rule that also faded the panel
// would give the drawer a slide over a fade, so one animation is the whole entrance.
test('the drawer panel declares one animation, not a slide plus a fade', () => {
  const declared = [
    ...surfaces.matchAll(/animation:\s*([a-z-]+)\s/g),
    ...appLayer.matchAll(
      /\.sgn-dialog-panel[^{]*\{[^}]*animation:\s*([a-z-]+)/g,
    ),
    ...packageLayer.matchAll(
      /\.sgn-dialog-panel[^{]*\{[^}]*animation:\s*([a-z-]+)/g,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(declared, ['sgn-drawer-in']);
  // Nothing in the panel's own rule fades it in or out beside the slide.
  const panel = rule(".sgn-dialog[data-size='drawer'] .sgn-dialog-panel {");
  assert.doesNotMatch(panel, /animation|opacity/);
});

// The row and the panel opened from it state the same frontage, depth, floors and creator: the
// panel reads the shared projection instead of phrasing its own copy, and a fact the record does
// not hold is the explicit marker rather than a line that simply disappears.
test('the panel states the four facts the row states, unknown ones explicitly', () => {
  assert.match(drawer, /recordFacts\(property, locale\)/);
  for (const fact of ['frontage', 'depth', 'floors', 'creator'])
    assert.match(
      drawer,
      new RegExp(`value: shared\\.${fact}\\.text`),
      `${fact} reads the shared projection`,
    );
  // The creator is a stated fact even when the record names nobody.
  assert.match(
    drawer,
    /label: text\.createdBy,[\s\S]{0,120}known: shared\.creator\.known/,
  );
  assert.doesNotMatch(drawer, /if \(property\.createdBy\)/);
});

// The drawer box is pinned to the viewport and does not scroll: scrolling inside the panel leaves
// the panel where it is, and the panel body is the drawer's one scroll container. Nothing is
// unreachable, because the body scrolls its own content inside the panel.
test('the drawer box does not scroll, so the panel holds the only scrollbar', () => {
  const box = rule("dialog.sgn-dialog[data-size='drawer'] {");
  assert.match(box, /height: 100dvh/);
  // `clip` rather than `hidden`: a hidden box can still be scrolled by a script or by focus
  // moving into it, and the panel would leave the screen with it.
  assert.match(box, /overflow: clip/);
  assert.doesNotMatch(box, /overflow: hidden/);
  // The one scroll container: the panel body the shared dialog rules already give the surface.
  assert.match(packageLayer, /\.sgn-dialog-body \{[^}]*overflow-y: auto/);
  const drawerRules = surfaces
    .split('}')
    .filter((block) => block.includes("data-size='drawer'"));
  for (const block of drawerRules)
    assert.doesNotMatch(block, /overflow-y:\s*(auto|scroll)/, block);
});
