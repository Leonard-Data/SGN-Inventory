import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { contentMime } from './content.ts';

test('actual supported image containers decode; truncated and mislabeled payloads cannot validate', async () => {
  for (const [format, mime] of [
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ] as const) {
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#137755' },
    })
      .toFormat(format)
      .toBuffer();
    assert.equal(await contentMime(bytes), mime);
    await assert.rejects(
      contentMime(bytes.subarray(0, Math.floor(bytes.length / 2))),
    );
  }
  await assert.rejects(
    contentMime(Buffer.from('Not a PDF, despite its filename and MIME label')),
  );
});

test('PDF completion requires its final cross-reference and EOF, not only a PDF prefix', async () => {
  const body =
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\n';
  const bytes = Buffer.from(
    body +
      'xref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000062 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n' +
      Buffer.byteLength(body) +
      '\n%%EOF\n',
  );
  assert.equal(await contentMime(bytes), 'application/pdf');
  await assert.rejects(contentMime(bytes.subarray(0, bytes.length - 10)));
  await assert.rejects(contentMime(Buffer.from('%PDF-1.4\ntruncated payload')));
  await assert.rejects(contentMime(Buffer.alloc(0)));
  const malformed = '%PDF-1.4\nNot a PDF object graph\n';
  await assert.rejects(
    contentMime(
      Buffer.from(
        malformed +
          'xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 >>\nstartxref\n' +
          Buffer.byteLength(malformed) +
          '\n%%EOF\n',
      ),
    ),
  );
});
