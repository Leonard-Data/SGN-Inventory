import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

export const maximumFileBytes = 20 * 1024 * 1024;
export const fileMimeTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export async function contentMime(bytes: Buffer): Promise<string> {
  if (bytes.length === 0 || bytes.length > maximumFileBytes)
    throw new Error('invalid-file');
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
    const eof = bytes.lastIndexOf('%%EOF');
    const start = bytes.lastIndexOf('startxref');
    if (
      !/^%PDF-[12]\.\d[\r\n]/.test(bytes.subarray(0, 10).toString('ascii')) ||
      start < 10 ||
      eof <= start
    )
      throw new Error('invalid-file');
    for (let index = eof + 5; index < bytes.length; index++) {
      const byte = bytes[index];
      if (
        byte !== 0 &&
        byte !== 9 &&
        byte !== 10 &&
        byte !== 12 &&
        byte !== 13 &&
        byte !== 32
      )
        throw new Error('invalid-file');
    }
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    document.getPageCount();
    return 'application/pdf';
  }
  const image = sharp(bytes, { failOn: 'warning' });
  const metadata = await image.metadata();
  const mime =
    metadata.format === 'jpeg'
      ? 'image/jpeg'
      : metadata.format === 'png'
        ? 'image/png'
        : metadata.format === 'webp'
          ? 'image/webp'
          : null;
  if (!mime) throw new Error('invalid-file');
  // Decode pixels, not just the header; bounded output catches truncated image payloads.
  await image.resize(1, 1).raw().toBuffer();
  return mime;
}
