import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ContactInputError,
  contactDraft,
  contactRequest,
  createWithContact,
} from './create-contact.ts';

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const route = source('../../app/api/properties/route.ts');
const createScreen = source('./create.tsx');
const captureForm = source('../properties/add-contact-number.tsx');

test('the create form asks for no contact unless a name and a number are both given', () => {
  assert.equal(contactDraft(undefined), null);
  assert.equal(contactDraft(null), null);
  assert.deepEqual(contactDraft({ display_name: '', phone: '' }), null);
  assert.deepEqual(contactDraft({ display_name: '  ', phone: ' ' }), null);
  // Half a pair is refused before anything is committed, so a property is never created for
  // contact details that cannot be recorded.
  assert.throws(
    () => contactDraft({ display_name: 'Chị Lan', phone: '' }),
    ContactInputError,
  );
  assert.throws(
    () => contactDraft({ display_name: '', phone: '0909123456' }),
    ContactInputError,
  );
  assert.throws(
    () => contactDraft({ display_name: 'Chị Lan' }),
    ContactInputError,
  );
  assert.throws(
    () => contactDraft({ display_name: 42, phone: '0909123456' }),
    ContactInputError,
  );
  assert.throws(
    () => contactDraft({ display_name: 'Chị Lan', phone: '0909', notes: 'x' }),
    ContactInputError,
  );
  assert.throws(() => contactDraft('Chị Lan 0909123456'), ContactInputError);
  assert.throws(
    () => contactDraft({ display_name: 'a'.repeat(201), phone: '0909123456' }),
    ContactInputError,
  );
  assert.throws(
    () => contactDraft({ display_name: 'Chị Lan', phone: '0'.repeat(101) }),
    ContactInputError,
  );
});

test('the contact request keeps the form text and the source number intact', () => {
  assert.deepEqual(
    contactDraft({ display_name: ' Chị Lan ', phone: ' 0909 123 456 ' }),
    {
      display_name: 'Chị Lan',
      phone: '0909 123 456',
    },
  );
  // The same request the property record's own capture form submits, so the guarded operation
  // validates and stores both surfaces identically: an unknown relation, no primary flag, one
  // number, and the source text kept beside it.
  assert.deepEqual(
    contactRequest({ display_name: 'Chị Lan', phone: '0909 123 456' }),
    {
      display_name: 'Chị Lan',
      phones: ['0909 123 456'],
      raw_phone_text: '0909 123 456',
      contact_type: 'unknown',
    },
  );
  assert.match(captureForm, /phones: \[phone\]/);
  assert.match(captureForm, /raw_phone_text: phone/);
  assert.match(captureForm, /contact_type: 'unknown'/);
});

test('the record is created first and the contact follows it', async () => {
  const asked: string[] = [];
  const { created, contact } = await createWithContact(
    async () => {
      asked.push('create');
      return { id: 'property-1', summary: null };
    },
    async (propertyId) => {
      asked.push('contact:' + propertyId);
      return 'contact-1';
    },
  );
  assert.deepEqual(asked, ['create', 'contact:property-1']);
  assert.deepEqual(created, { id: 'property-1', summary: null });
  assert.deepEqual(contact, { id: 'contact-1' });
});

test('a refused contact leaves the created record standing and reports the refusal', async () => {
  let captures = 0;
  const { created, contact } = await createWithContact(
    async () => ({ id: 'property-1' }),
    async () => {
      captures += 1;
      throw Object.assign(new Error('invalid-input'), {
        code: 'invalid-input',
      });
    },
  );
  // The property is committed, once, and the contact failure is stated beside it: nothing is
  // rolled back, silently dropped or resubmitted.
  assert.deepEqual(created, { id: 'property-1' });
  assert.deepEqual(contact, { error: 'invalid-input' });
  assert.equal(captures, 1);

  const unclassified = await createWithContact(
    async () => ({ id: 'property-1' }),
    async () => {
      throw new Error('network');
    },
  );
  assert.deepEqual(unclassified.contact, { error: 'unavailable' });

  // An answer without an identifier is not a confirmation of a recorded contact either.
  const unidentified = await createWithContact(
    async () => ({ id: 'property-1' }),
    async () => null,
  );
  assert.deepEqual(unidentified.contact, { error: 'unavailable' });
});

test('the create route reads the contact details before it writes the record', () => {
  assert.match(route, /const contact = contactChanges\(body\.contact\)/);
  assert.match(route, /delete body\.contact/);
  assert.ok(
    route.indexOf('contactChanges(body.contact)') <
      route.indexOf('createProperty(context, body)'),
    'the contact details are validated before the property is written',
  );
  assert.match(route, /createWithContact\(/);
  assert.match(route, /status: 201/);
});

test('the create screen submits the owner contact and states a contact that failed', () => {
  assert.match(createScreen, /name="contact_display_name"/);
  assert.match(createScreen, /name="contact_phone"/);
  assert.match(
    createScreen,
    /contact: \{ display_name: contactName, phone: contactPhone \}/,
  );
  // Half a pair is refused on the screen too, with the capture form's own wording.
  assert.match(createScreen, /copy\.contactNumberInvalid/);
  assert.match(createScreen, /tone: 'danger'/);
  assert.match(createScreen, /copy\.createContactFailed/);
});
