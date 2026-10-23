import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages } from '../../i18n/messages.ts';
import {
  EMPLOYEE_BIO_MAX_LENGTH,
  EMPLOYEE_NAME_MAX_LENGTH,
  EMPLOYEE_PHONE_MAX_LENGTH,
  myProfileBody,
  parseMyProfile,
  parseProfileUpdate,
  profileBody,
  profileEditable,
  profileProblems,
  textProblem,
} from './profile.ts';

const admin = {
  displayName: 'Nguyễn Thị An',
  phone: '0909 111 222',
  role: 'staff',
  bio: 'Phụ trách khu vực Quận 3.',
};

test('the documented length limits are the ones enforced', () => {
  assert.equal(EMPLOYEE_NAME_MAX_LENGTH, 120);
  assert.equal(EMPLOYEE_PHONE_MAX_LENGTH, 40);
  assert.equal(EMPLOYEE_BIO_MAX_LENGTH, 280);
  assert.equal(textProblem('displayName', 'a'.repeat(120)), null);
  assert.equal(textProblem('displayName', 'a'.repeat(121))?.code, 'too-long');
  assert.equal(textProblem('phone', '9'.repeat(40)), null);
  assert.equal(textProblem('phone', '9'.repeat(41))?.code, 'too-long');
  assert.equal(textProblem('bio', 'a'.repeat(280)), null);
  assert.equal(textProblem('bio', 'a'.repeat(281))?.code, 'too-long');
});

test('a name is required and the other profile fields are optional', () => {
  assert.equal(textProblem('displayName', '   ')?.code, 'required');
  assert.equal(textProblem('phone', ''), null);
  assert.equal(textProblem('bio', ''), null);
});

test('the bio and the name stay plain text: no markup and no link', () => {
  assert.equal(textProblem('bio', 'Xem <b>nhà</b>')?.code, 'plain-text');
  assert.equal(
    textProblem('bio', 'Chi tiết tại https://example.test')?.code,
    'plain-text',
  );
  assert.equal(
    textProblem('bio', 'Chi tiết tại www.example.test')?.code,
    'plain-text',
  );
  assert.equal(textProblem('bio', 'Môi giới nhà phố, 8 năm kinh nghiệm'), null);
});

test('a problem names its own field so the form can show it there', () => {
  const problems = profileProblems(
    { displayName: 'a'.repeat(200), phone: '9'.repeat(41), bio: '<i>x</i>' },
    ['displayName', 'phone', 'bio'],
  );
  assert.deepEqual(
    problems.map((problem) => [problem.field, problem.code]),
    [
      ['displayName', 'too-long'],
      ['phone', 'too-long'],
      ['bio', 'plain-text'],
    ],
  );
});

test('the admin payload is exactly the four editable fields', () => {
  assert.deepEqual(profileBody({ ...admin }), admin);
  // The email that identifies the account is not a field of this payload at all.
  assert.equal(profileBody({ ...admin, email: 'other@example.test' }), null);
  assert.equal(
    profileBody({ displayName: 'An', phone: '', role: 'staff' }),
    null,
  );
  assert.equal(profileBody({ ...admin, role: 'owner' }), null);
  assert.equal(profileBody({ ...admin, phone: 42 }), null);
  assert.equal(
    profileBody({ ...admin, bio: 'a'.repeat(EMPLOYEE_BIO_MAX_LENGTH + 1) }),
    null,
  );
});

test('the self payload carries the person’s name and bio and nothing else', () => {
  assert.deepEqual(myProfileBody({ displayName: 'An', bio: 'Xin chào' }), {
    displayName: 'An',
    bio: 'Xin chào',
  });
  // A caller-supplied employee, role, phone or email is refused by shape: this path cannot
  // name another person or reach a field it does not own.
  assert.equal(
    myProfileBody({ displayName: 'An', bio: '', employeeId: 'x' }),
    null,
  );
  assert.equal(
    myProfileBody({ displayName: 'An', bio: '', role: 'admin' }),
    null,
  );
  assert.equal(
    myProfileBody({ displayName: 'An', bio: '', phone: '0909' }),
    null,
  );
  assert.equal(
    myProfileBody({ displayName: 'An', bio: 'x@example.test', email: 'a@b.c' }),
    null,
  );
  assert.equal(myProfileBody({ displayName: '   ', bio: '' }), null);
  assert.equal(myProfileBody({ displayName: 'An' }), null);
});

test('the recorded reply is revalidated before it is reported as saved', () => {
  assert.deepEqual(parseProfileUpdate({ changed: ['displayName', 'bio'] }), {
    changed: ['displayName', 'bio'],
  });
  assert.deepEqual(parseProfileUpdate({ changed: [] }), { changed: [] });
  // A field this interface does not edit, a duplicate or a malformed reply is refused rather
  // than rendered as a saved profile.
  assert.equal(parseProfileUpdate({ changed: ['email'] }), null);
  assert.equal(parseProfileUpdate({ changed: ['bio', 'bio'] }), null);
  assert.equal(parseProfileUpdate({ changed: 'bio' }), null);
  assert.equal(parseProfileUpdate(null), null);
  assert.deepEqual(parseMyProfile({ displayName: 'An', bio: null }), {
    displayName: 'An',
    bio: null,
  });
  assert.equal(parseMyProfile({ displayName: '  ', bio: null }), null);
  assert.equal(parseMyProfile({ displayName: 'An', bio: 7 }), null);
});

test('only a live or never-activated identity offers an editable entry', () => {
  assert.equal(profileEditable('active'), true);
  assert.equal(profileEditable('unlinked'), true);
  assert.equal(profileEditable('inactive'), false);
  assert.equal(profileEditable('account_deleted'), false);
});

test('both languages name the profile fields, the limit and the refusal', () => {
  for (const locale of ['vi', 'en'] as const) {
    const text = messages[locale];
    for (const value of [
      text.employeeBio,
      text.employeePhone,
      text.employeeEdit,
      text.employeeProfileTitle,
      text.employeeProfileSave,
      text.employeeProfileBioHint,
      text.employeeProfileBioTooLong,
      text.employeeProfilePlainText,
      text.employeeEditNotEditable,
      text.employeeEditLastAdmin,
    ])
      assert.ok(value.trim().length > 0);
    assert.match(text.employeeProfileBioHint, /280/);
  }
});
