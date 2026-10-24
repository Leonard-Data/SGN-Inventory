import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { messages } from '../../i18n/messages.ts';
import { formChanges } from '../property-maintenance/fields.ts';

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

// The row and the panel opened from it state the same frontage, depth, floors and attribution:
// the panel reads the shared projection instead of phrasing its own copy, and a fact the record
// does not hold is the explicit marker rather than a line that simply disappears.
test('the panel states the four facts the row states, unknown ones explicitly', () => {
  assert.match(drawer, /recordFacts\(property, locale\)/);
  for (const fact of ['frontage', 'depth', 'floors', 'creator', 'modifier'])
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
  // The quick view names both colleagues: who created the record and who last modified it, each
  // from the summary it already holds rather than from a read of its own.
  assert.match(
    drawer,
    /label: text\.modifiedBy,[\s\S]{0,120}known: shared\.modifier\.known/,
  );
  assert.doesNotMatch(drawer, /list_employee_names|updated_by/);
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

// The property's note is read in the panel itself: the record's own `notes`, labelled, as source
// text with its line breaks kept and wrapping inside the panel. It is edited in place from the same
// row, so a record with no note still offers the pencil and a cleared field removes the note.
test('the panel states the recorded note and edits it in place', () => {
  assert.match(
    drawer,
    /const note = record\?\.notes\?\.trim\(\) \? record\.notes : null;/,
  );
  // The row is drawn whenever the record holds a note or the session may add one, so a record with
  // no note is not a row that simply disappears.
  assert.match(drawer, /\{note !== null \|\| canEdit \? \(/);
  assert.match(drawer, /<dt>\{text\.notes\}<\/dt>/);
  // Source text: shown as recorded, never translated, and a missing note reads as the marker the
  // rest of the panel states rather than as a blank.
  assert.match(
    drawer,
    /<span\s+className=\{\s*'quick-view-note-text' \+ \(note \? '' : ' is-unknown'\)\s*\}\s+translate="no"\s*>\s*\{note \?\? text\.unknown\}/,
  );
  // A long note takes the full row and keeps its own line breaks inside it, with the pencil beside
  // it rather than pushed to the bottom of the value.
  assert.match(drawer, /<div className="fact span-all">\s*<dt>\{text\.notes\}/);
  assert.match(rule('.quick-view-note-text {'), /white-space: pre-wrap/);
  assert.match(rule('.quick-view-note-text {'), /overflow-wrap: anywhere/);
  assert.match(rule('.quick-view-note {'), /display: flex/);
  // The label exists in both languages, and so do the two names of the pencil.
  assert.notEqual(messages.vi.notes, messages.en.notes);
  for (const key of ['notes', 'editNote', 'addNote'] as const) {
    for (const locale of ['vi', 'en'] as const)
      assert.ok(
        messages[locale][key].trim().length,
        `${locale}.${key} is missing`,
      );
    assert.notEqual(messages.vi[key], messages.en[key]);
  }
});

// The pencil is the price row's own in-place edit: it opens an editor in the value's place, names
// its state, and hands the focus back to itself when the editor closes. It is offered only where
// the full record would be editable, from the same permission answer the price edit reads.
test('the note pencil edits in place, for a session that may edit the record', () => {
  assert.match(
    drawer,
    /const \[editingNote, setEditingNote\] = useState\(false\);/,
  );
  assert.match(
    drawer,
    /const noteButton = useRef<HTMLButtonElement \| null>\(null\);/,
  );
  // One gate for the whole surface, never a second rule for this control.
  assert.match(
    drawer,
    /\{canEdit \? \(\s*<button\s*className="quick-view-reveal"\s*ref=\{noteButton\}/,
  );
  assert.match(drawer, /aria-expanded=\{editingNote\}/);
  assert.match(drawer, /aria-label=\{note \? text\.editNote : text\.addNote\}/);
  // Escape cancels the open edit instead of taking the whole panel - and the note being typed -
  // with it, and the focus that the close restores is the pencil that opened it.
  assert.match(
    drawer,
    /onKeyDown=\{\(event\) => \{\s*if \(event\.key !== 'Escape'\) return;\s*event\.preventDefault\(\);\s*closeNoteEdit\(\);\s*\}\}/,
  );
  assert.match(
    drawer,
    /function closeNoteEdit\(\) \{\s*setEditingNote\(false\);\s*requestAnimationFrame\(\(\) => noteButton\.current\?\.focus\(\)\);/,
  );
  assert.match(drawer, /onCancel=\{closeNoteEdit\}/);
});

// The note edit is the record editor's own form and write path, not a second writer: the same field
// record, the same target, the same route the full record posts to, so validation and refusals are
// identical. No explanation travels with it, so the database's price-only history records nothing.
test('the note edit reuses the record editor path and records no history', () => {
  assert.match(drawer, /const NOTE_FIELDS = \['notes'\] as const;/);
  const editor = drawer.slice(drawer.indexOf('function QuickFieldEditor('));
  assert.match(editor, /<MutationForm[\s\S]{0,400}target="property"/);
  assert.match(editor, /`\/api\/properties\/\$\{propertyId\}\/maintenance`/);
  assert.match(
    editor,
    /target: 'property',\s*targetId: propertyId,\s*revision: record\.revision,\s*propertyRevision: record\.revision,/,
  );
  assert.match(
    editor,
    /<RecordFields locale=\{locale\} values=\{record\} names=\{names\} \/>/,
  );
  assert.doesNotMatch(editor, /explanation/);
  // A cleared field is the record's own null: the note is removed, not replaced by a blank note.
  const form = new FormData();
  form.set('notes', '');
  assert.deepEqual(formChanges('property', form, { notes: 'Recorded note' }), {
    notes: null,
  });
  // A note that is left as it was is no change at all, which the editor refuses rather than
  // writing an identical value back.
  const unchanged = new FormData();
  unchanged.set('notes', 'Recorded note');
  assert.deepEqual(
    formChanges('property', unchanged, { notes: 'Recorded note' }),
    {},
  );
});

// The quick view states the record's property type and offers to change it through the same field
// record, the same target and the same maintenance route the full editor writes it through, so the
// options, the validation and the refusals are that one path's rather than a second writer's.
test('the quick view saves a changed property type through the record editor path', () => {
  assert.match(drawer, /const TYPE_FIELDS = \['property_type'\] as const;/);
  assert.match(drawer, /data-od-id="quick-view-type"/);
  // The stated value is labelled through the one status/option dictionary.
  assert.match(drawer, /\{label\(locale, statedType\)\}/);
  const section = drawer.slice(
    drawer.indexOf('data-od-id="quick-view-type"'),
    drawer.indexOf('aria-labelledby={factsId}'),
  );
  assert.match(section, /<QuickFieldEditor[\s\S]{0,240}names=\{TYPE_FIELDS\}/);
  assert.match(section, /onDone=\{typeSaved\}/);
  assert.match(section, /onCancel=\{closeTypeEdit\}/);
  // The one save path every quick-view field edit takes: the record's own revision against the
  // maintenance route, so a stale panel is refused rather than overwriting a newer record.
  assert.match(drawer, /`\/api\/properties\/\$\{propertyId\}\/maintenance`/);
  assert.match(
    drawer,
    /target: 'property',\s*targetId: propertyId,\s*revision: record\.revision,\s*propertyRevision: record\.revision,/,
  );
  // A chosen type that differs from the recorded one is the change the save submits, and the
  // same choice saved again is no change at all.
  const changed = new FormData();
  changed.set('property_type', 'villa');
  assert.deepEqual(
    formChanges('property', changed, { property_type: 'house' }),
    { property_type: 'villa' },
  );
  const unchanged = new FormData();
  unchanged.set('property_type', 'house');
  assert.deepEqual(
    formChanges('property', unchanged, { property_type: 'house' }),
    {},
  );
});

// Only a person who may edit the record is offered the type control; everybody else still reads
// the type, so the fact is never hidden to state a permission.
test('the property type is read-only for somebody who may not edit the record', () => {
  const section = drawer.slice(
    drawer.indexOf('data-od-id="quick-view-type"'),
    drawer.indexOf('aria-labelledby={factsId}'),
  );
  // The value is stated outside the permission, the control inside it.
  const value = section.indexOf('{label(locale, statedType)}');
  const gate = section.indexOf('{canEdit ? (');
  const control = section.indexOf('{text.editPropertyType}');
  assert.ok(value >= 0 && gate > value && control > gate);
});

// A refused save states the refusal and leaves the stated type as the record holds it: the panel
// only reads a new type back after the record itself answers with it.
test('a refused property type save leaves the stated type untouched', () => {
  const section = drawer.slice(
    drawer.indexOf('data-od-id="quick-view-type"'),
    drawer.indexOf('aria-labelledby={factsId}'),
  );
  // The value comes from the record the server answered with, never from the editor's draft: the
  // summary the row handed over is only the value until the record itself has been read.
  assert.doesNotMatch(section, /setRecord|propertyType =/);
  assert.match(
    drawer,
    /const statedType = record\?\.property_type \?\? property\.propertyType;/,
  );
  // The only way a new type reaches the panel is the reload a committed save asks for.
  assert.match(
    drawer,
    /function typeSaved\(\) \{\s*closeTypeEdit\(\);\s*reloadRecord\(\);/,
  );
  // The editor reports a refusal instead of closing, and closing is only what `typeSaved` does.
  const editor = drawer.slice(drawer.indexOf('function QuickFieldEditor('));
  assert.match(editor, /onDenied=\{onDenied\}/);
  assert.match(editor, /onSaved=\{\(\) => \{/);
});

test('the property type edit carries both languages', () => {
  for (const locale of ['vi', 'en'] as const)
    assert.ok(
      messages[locale].editPropertyType.trim().length,
      `${locale}.editPropertyType`,
    );
  assert.notEqual(messages.vi.editPropertyType, messages.en.editPropertyType);
});
