import assert from 'node:assert/strict';
import test from 'node:test';
import { countRefusal, fileClass, fileLimits, sizeRefusal } from './limits.ts';

test('the validated content type decides the class, not the chosen purpose', () => {
  assert.equal(fileClass('application/pdf'), 'document');
  for (const mimeType of ['image/jpeg', 'image/png', 'image/webp'])
    assert.equal(fileClass(mimeType), 'image');
  assert.equal(fileClass('text/plain'), null);
  assert.equal(fileClass(''), null);
});

test('a property keeps at most 5 documents of up to 20 MiB each', () => {
  assert.equal(fileLimits.document.maximumBytes, 20 * 1024 * 1024);
  for (let existing = 0; existing < 5; existing++)
    assert.equal(countRefusal('document', existing), null);
  assert.equal(countRefusal('document', 5), 'document-limit');
  assert.equal(countRefusal('document', 6), 'document-limit');
  assert.equal(sizeRefusal('document', 20 * 1024 * 1024), null);
  assert.equal(sizeRefusal('document', 20 * 1024 * 1024 + 1), 'file-too-large');
});

test('a property keeps at most 10 images of up to 5 MiB each', () => {
  assert.equal(fileLimits.image.maximumBytes, 5 * 1024 * 1024);
  for (let existing = 0; existing < 10; existing++)
    assert.equal(countRefusal('image', existing), null);
  assert.equal(countRefusal('image', 10), 'image-limit');
  assert.equal(countRefusal('image', 11), 'image-limit');
  assert.equal(sizeRefusal('image', 5 * 1024 * 1024), null);
  assert.equal(sizeRefusal('image', 5 * 1024 * 1024 + 1), 'image-too-large');
});

test('the document cap does not leak into the image cap', () => {
  assert.equal(countRefusal('image', 5), null);
  assert.equal(countRefusal('document', 10), 'document-limit');
  // A 6 MiB PDF is over the image cap and inside its own.
  assert.equal(sizeRefusal('document', 6 * 1024 * 1024), null);
  assert.equal(sizeRefusal('image', 6 * 1024 * 1024), 'image-too-large');
});
