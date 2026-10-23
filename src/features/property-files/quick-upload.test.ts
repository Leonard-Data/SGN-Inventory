// One quick upload: the refusals that never reach the network, the order the path pins
// (register, PUT, read back, validate and complete), and the recovery reads that make a lost
// response safe to look at instead of assume. The transport is a stub, so every call is asserted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { fileLimits } from './limits.ts';
import {
  quickUpload,
  quickUploadPurpose,
  QUICK_UPLOAD_CATEGORY_ID,
  type QuickUploadProgress,
  type QuickUploadRegistration,
  type QuickUploadRegistrationResult,
  type QuickUploadStored,
  type QuickUploadTransport,
} from './quick-upload.ts';

const bytes = (...values: number[]) => new Uint8Array(values);
const sha256 = (data: Uint8Array<ArrayBuffer>) =>
  createHash('sha256').update(data).digest('hex');
const upload = (name: string, type: string, data: Uint8Array<ArrayBuffer>) =>
  new File([data], name, { type });

const stored = (
  state: QuickUploadStored['objectState'],
): QuickUploadStored => ({
  file: { upload_status: 'registered', validated_object_id: null },
  objectState: state,
});
const storedReady = (): QuickUploadStored => ({
  file: {
    upload_status: 'ready',
    validated_object_id: '55555555-5555-4555-8555-555555555555',
  },
  objectState: 'present',
});

// A transport that records the steps it is asked to run. Each step's answer is injected, so one
// test can state exactly what the path did and in what order.
function recording(answers: {
  registration?: QuickUploadRegistrationResult;
  recovered?: QuickUploadStored[];
  recoveryError?: string;
  completeFails?: { code: string; status: number };
  afterComplete?: QuickUploadStored[];
  afterCompleteFails?: boolean;
}) {
  const calls: string[] = [];
  const registrations: QuickUploadRegistration[] = [];
  let recoveryCount = 0;
  const transport: QuickUploadTransport = {
    register: (registration) => {
      calls.push('register');
      registrations.push(registration);
      return Promise.resolve(
        answers.registration ?? {
          uploadUrl: 'https://storage.example/signed',
          uploadBytes: registration.sizeBytes,
        },
      );
    },
    put: (url, file, mimeType) => {
      calls.push(`put:${mimeType}`);
      return Promise.resolve();
    },
    recovery: () => {
      calls.push('recovery');
      recoveryCount += 1;
      if (
        recoveryCount > 1 &&
        (answers.afterComplete !== undefined || answers.afterCompleteFails)
      ) {
        if (answers.afterCompleteFails)
          return Promise.reject(new Error('gone'));
        return Promise.resolve({ uploads: answers.afterComplete! });
      }
      if (answers.recoveryError !== undefined)
        return Promise.resolve({
          uploads: [{ ...stored('absent'), error: answers.recoveryError }],
        });
      return Promise.resolve({
        uploads: answers.recovered ?? [stored('present')],
      });
    },
    complete: () => {
      calls.push('complete');
      return answers.completeFails
        ? Promise.reject(answers.completeFails)
        : Promise.resolve();
    },
  };
  return { calls, registrations, transport };
}

// A transport that fails the test's own premise if the path calls it at all.
function untouched() {
  const calls: string[] = [];
  const refuse = (step: string) => () => {
    calls.push(step);
    return Promise.reject(new Error(`${step} was not expected`));
  };
  const transport: QuickUploadTransport = {
    register: refuse('register'),
    put: refuse('put'),
    recovery: refuse('recovery'),
    complete: refuse('complete'),
  };
  return { calls, transport };
}

test('the purpose follows the bytes: an image is a photo, everything else a document', () => {
  assert.equal(quickUploadPurpose('image/jpeg'), 'photo');
  assert.equal(quickUploadPurpose('image/png'), 'photo');
  assert.equal(quickUploadPurpose('image/webp'), 'photo');
  assert.equal(quickUploadPurpose('application/pdf'), 'document');
  for (const type of ['text/plain', 'image/gif', 'application/zip', ''])
    assert.equal(quickUploadPurpose(type), null, `type=${type}`);
});

test('a refused file never reaches the network', async () => {
  const cases = [
    [
      'unsupported format',
      upload('notes.txt', 'text/plain', bytes(1, 2, 3)),
      'unsupported-format',
    ],
    [
      'empty file',
      upload('empty.pdf', 'application/pdf', new Uint8Array()),
      'empty-file',
    ],
    [
      'oversized image',
      upload(
        'big.jpg',
        'image/jpeg',
        new Uint8Array(fileLimits.image.maximumBytes + 1),
      ),
      'image-too-large',
    ],
    [
      'oversized document',
      upload(
        'big.pdf',
        'application/pdf',
        new Uint8Array(fileLimits.document.maximumBytes + 1),
      ),
      'file-too-large',
    ],
  ] as const;
  for (const [name, file, code] of cases) {
    const { calls, transport } = untouched();
    assert.deepEqual(
      await quickUpload({ file, transport }),
      {
        ok: false,
        code,
        status: null,
      },
      name,
    );
    assert.deepEqual(calls, [], name);
  }
});

test('the whole path runs register, PUT, read back and complete in that order', async () => {
  const data = bytes(
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    1,
    2,
    3,
    4,
  );
  const file = upload('cổng.png', 'image/png', data);
  const { calls, registrations, transport } = recording({});
  const progress: QuickUploadProgress[] = [];
  const outcome = await quickUpload({
    file,
    transport,
    uuid: () => '77777777-7777-4777-8777-777777777777',
    onProgress: (state) => progress.push(state),
  });
  assert.deepEqual(outcome, {
    ok: true,
    fileId: '77777777-7777-4777-8777-777777777777',
    purpose: 'photo',
  });
  assert.deepEqual(calls, [
    'register',
    'put:image/png',
    'recovery',
    'complete',
  ]);
  assert.deepEqual(progress, [
    'registering',
    'uploading',
    'validating',
    'done',
  ]);
  // The registration pins the file's own identity: name, bytes, count and hash as they are, in
  // the built-in Other category, never overwriting anything.
  const registration = registrations[0]!;
  assert.deepEqual(registration, {
    fileId: '77777777-7777-4777-8777-777777777777',
    originalFilename: 'cổng.png',
    mimeType: 'image/png',
    sizeBytes: data.byteLength,
    sha256: sha256(data),
    purpose: 'photo',
    categoryId: QUICK_UPLOAD_CATEGORY_ID,
  });
});

test('a PDF at its class limit is accepted as a document', async () => {
  const data = new Uint8Array(fileLimits.document.maximumBytes);
  data[0] = 37; // '%'
  const file = upload('hồ sơ.pdf', 'application/pdf', data);
  const { calls, transport } = recording({});
  const outcome = await quickUpload({
    file,
    transport,
    uuid: () => 'file-pdf',
  });
  assert.deepEqual(outcome, {
    ok: true,
    fileId: 'file-pdf',
    purpose: 'document',
  });
  assert.deepEqual(calls, [
    'register',
    'put:application/pdf',
    'recovery',
    'complete',
  ]);
});

test('a registration that answers a different byte count stops before the PUT', async () => {
  const data = bytes(1, 2, 3, 4, 5);
  const file = upload('a.pdf', 'application/pdf', data);
  const { calls, transport } = recording({
    registration: {
      uploadUrl: 'https://storage.example/signed',
      uploadBytes: 4,
    },
  });
  assert.deepEqual(await quickUpload({ file, transport }), {
    ok: false,
    code: 'file-mismatch',
    status: null,
  });
  assert.deepEqual(calls, ['register']);
});

test('a registration the read back cannot find is not-found and is never completed', async () => {
  const { calls, transport } = recording({ recovered: [] });
  assert.deepEqual(
    await quickUpload({
      file: upload('a.pdf', 'application/pdf', bytes(1)),
      transport,
    }),
    { ok: false, code: 'not-found', status: null },
  );
  assert.deepEqual(calls, ['register', 'put:application/pdf', 'recovery']);
});

test('stored bytes the read back cannot vouch for are refused, not completed', async () => {
  for (const [state, code] of [
    ['absent', 'missing-bytes'],
    ['unknown', 'unknown-object-state'],
    ['unusable', 'unknown-object-state'],
  ] as const) {
    const { calls, transport } = recording({ recovered: [stored(state)] });
    assert.deepEqual(
      await quickUpload({
        file: upload('a.pdf', 'application/pdf', bytes(1)),
        transport,
      }),
      { ok: false, code, status: null },
      state,
    );
    assert.ok(!calls.includes('complete'), state);
  }
  // A stated reason outranks the state word: the path reports what it was actually told.
  const { transport } = recording({ recoveryError: 'replacement-required' });
  assert.deepEqual(
    await quickUpload({
      file: upload('a.pdf', 'application/pdf', bytes(1)),
      transport,
    }),
    { ok: false, code: 'replacement-required', status: null },
  );
});

test('an already-validated registration succeeds from the read back without completing', async () => {
  const { calls, transport } = recording({ recovered: [storedReady()] });
  const progress: QuickUploadProgress[] = [];
  const outcome = await quickUpload({
    file: upload('a.pdf', 'application/pdf', bytes(1)),
    transport,
    uuid: () => 'done-file',
    onProgress: (state) => progress.push(state),
  });
  assert.deepEqual(outcome, {
    ok: true,
    fileId: 'done-file',
    purpose: 'document',
  });
  assert.deepEqual(calls, ['register', 'put:application/pdf', 'recovery']);
  assert.deepEqual(progress, ['registering', 'uploading', 'done']);
});

test('a lost completion answer is re-checked before it is reported as failed', async () => {
  // The completion committed and only its response was lost: the store proves it succeeded.
  const lost = recording({
    completeFails: { code: 'unavailable', status: 503 },
    afterComplete: [storedReady()],
  });
  const outcome = await quickUpload({
    file: upload('a.pdf', 'application/pdf', bytes(1)),
    transport: lost.transport,
    uuid: () => 'lost-file',
  });
  assert.deepEqual(outcome, {
    ok: true,
    fileId: 'lost-file',
    purpose: 'document',
  });
  assert.deepEqual(lost.calls, [
    'register',
    'put:application/pdf',
    'recovery',
    'complete',
    'recovery',
  ]);
  // The completion really failed: the re-check says so, and the failure carries its own code and
  // status rather than a generic one.
  const failed = recording({
    completeFails: { code: 'invalid-file', status: 422 },
    afterComplete: [stored('present')],
  });
  assert.deepEqual(
    await quickUpload({
      file: upload('a.pdf', 'application/pdf', bytes(1)),
      transport: failed.transport,
    }),
    { ok: false, code: 'invalid-file', status: 422 },
  );
  // The re-check itself was lost too: the failure stands as reported, unresolved.
  const unreadable = recording({
    completeFails: { code: 'unavailable', status: 503 },
    afterCompleteFails: true,
  });
  assert.deepEqual(
    await quickUpload({
      file: upload('a.pdf', 'application/pdf', bytes(1)),
      transport: unreadable.transport,
    }),
    { ok: false, code: 'unavailable', status: 503 },
  );
});
