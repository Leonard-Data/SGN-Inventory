import assert from 'node:assert/strict';
import test from 'node:test';
import { fileClass, fileLimits, sizeRefusal } from './limits.ts';

test('the validated content type decides the class, not the chosen purpose', () => {
  assert.equal(fileClass('application/pdf'), 'document');
  for (const mimeType of ['image/jpeg', 'image/png', 'image/webp'])
    assert.equal(fileClass(mimeType), 'image');
  assert.equal(fileClass('text/plain'), null);
  assert.equal(fileClass(''), null);
});

test('a document may be up to 20 MiB and an image up to 5 MiB', () => {
  assert.equal(fileLimits.document.maximumBytes, 20 * 1024 * 1024);
  assert.equal(fileLimits.image.maximumBytes, 5 * 1024 * 1024);
  assert.equal(sizeRefusal('document', 20 * 1024 * 1024), null);
  assert.equal(sizeRefusal('document', 20 * 1024 * 1024 + 1), 'file-too-large');
  assert.equal(sizeRefusal('image', 5 * 1024 * 1024), null);
  assert.equal(sizeRefusal('image', 5 * 1024 * 1024 + 1), 'image-too-large');
  // A 6 MiB PDF is over the image cap and inside its own.
  assert.equal(sizeRefusal('document', 6 * 1024 * 1024), null);
  assert.equal(sizeRefusal('image', 6 * 1024 * 1024), 'image-too-large');
});
