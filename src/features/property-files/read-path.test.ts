import assert from 'node:assert/strict';
import test from 'node:test';
import {
  signAuthorizedFile,
  type FileSigning,
  type Lookup,
} from './read-path.ts';

const propertyId = '20000000-0000-4000-8000-000000000001';
const fileId = '40000000-0000-4000-8000-000000000001';
const file = {
  objectPath: `${propertyId}/${fileId}/content`,
  originalFilename: 'Giấy chứng nhận.pdf',
};

function signing(patch: Partial<FileSigning> = {}) {
  const presigned: Array<{ objectPath: string; filename?: string }> = [];
  const dependencies: FileSigning = {
    readProperty: async () => ({ found: { id: propertyId } }),
    readFile: async () => ({ found: file }),
    presign: async (objectPath, filename) => {
      presigned.push({ objectPath, ...(filename ? { filename } : {}) });
      return { url: 'https://r2.example.test/signed', expiresIn: 60 };
    },
    now: () => 1_700_000_000_000,
    ...patch,
  };
  return { dependencies, presigned };
}

test('a readable completed record earns a 60-second URL and nothing more', async () => {
  const { dependencies, presigned } = signing();
  const outcome = await signAuthorizedFile(dependencies, {
    propertyId,
    fileId,
    download: false,
  });
  assert.deepEqual(outcome, {
    status: 'signed',
    url: 'https://r2.example.test/signed',
    expiresAt: 1_700_000_000 + 60,
  });
  assert.deepEqual(presigned, [{ objectPath: file.objectPath }]);
});

test('the reported expiry follows the lifetime the signer actually used', async () => {
  const { dependencies } = signing({
    presign: async () => ({
      url: 'https://r2.example.test/signed',
      expiresIn: 90,
    }),
  });
  const outcome = await signAuthorizedFile(dependencies, {
    propertyId,
    fileId,
    download: false,
  });
  assert.deepEqual(outcome, {
    status: 'signed',
    url: 'https://r2.example.test/signed',
    expiresAt: 1_700_000_000 + 90,
  });
});

test('downloading keeps the original Vietnamese filename, opening does not', async () => {
  const download = signing();
  await signAuthorizedFile(download.dependencies, {
    propertyId,
    fileId,
    download: true,
  });
  assert.deepEqual(download.presigned, [
    { objectPath: file.objectPath, filename: file.originalFilename },
  ]);
});

test('an archived property hidden from a non-reviewer mints no URL at all', async () => {
  // The caller's own read is the authority: a non-reviewer cannot see an archived property,
  // so the lookup refuses before any file record is even read.
  let filesRead = 0;
  const { dependencies, presigned } = signing({
    readProperty: async () => ({ refused: 404 }) as Lookup<unknown>,
    readFile: async () => {
      filesRead++;
      return { found: file };
    },
  });
  const outcome = await signAuthorizedFile(dependencies, {
    propertyId,
    fileId,
    download: false,
  });
  assert.deepEqual(outcome, { status: 404, code: 'not-found' });
  assert.equal(filesRead, 0);
  assert.deepEqual(presigned, []);
});

test('an unreadable file record mints no URL and a denied read stays access-denied', async () => {
  const missing = signing({ readFile: async () => ({ refused: 404 }) });
  assert.deepEqual(
    await signAuthorizedFile(missing.dependencies, {
      propertyId,
      fileId,
      download: true,
    }),
    { status: 404, code: 'not-found' },
  );
  assert.deepEqual(missing.presigned, []);

  const denied = signing({ readFile: async () => ({ refused: 403 }) });
  assert.deepEqual(
    await signAuthorizedFile(denied.dependencies, {
      propertyId,
      fileId,
      download: false,
    }),
    { status: 403, code: 'access-denied' },
  );
  assert.deepEqual(denied.presigned, []);

  const unavailable = signing({ readProperty: async () => ({ refused: 503 }) });
  assert.deepEqual(
    await signAuthorizedFile(unavailable.dependencies, {
      propertyId,
      fileId,
      download: false,
    }),
    { status: 503, code: 'unavailable' },
  );
  assert.deepEqual(unavailable.presigned, []);
});
