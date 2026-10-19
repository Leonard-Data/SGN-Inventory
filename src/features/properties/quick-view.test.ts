import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { messages } from '../../i18n/messages.ts';

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const drawer = source('./property-drawer.tsx');
const dialog = source('./detail-dialog.tsx');
const surfaces = source('../../app/sgn-surfaces.css');

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
  // A narrow desktop keeps a column of the list beside the panel instead of covering the row.
  const narrow = surfaces.indexOf('@media (min-width: 641px)');
  assert.ok(narrow > 0, 'the narrow-desktop rule exists');
  assert.match(
    surfaces.slice(narrow, surfaces.indexOf('@media', narrow + 1)),
    /dialog\.sgn-dialog\[data-size='drawer'\][\s\S]*width: min\(460px, calc\(100vw - 320px\)\)/,
  );
  assert.match(
    rule("dialog.sgn-dialog[data-size='drawer']::backdrop"),
    /background: transparent/,
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
