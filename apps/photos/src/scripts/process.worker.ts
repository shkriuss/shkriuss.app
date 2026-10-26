/**
 * Reads picked photos in a web worker, so the page never freezes on big
 * files: the original's SHA-256 (to spot a photo added twice), when it was
 * taken (Exif), and two JPEG copies made smaller, a thumbnail for the grid
 * and one for looking at it on a screen. The original itself is kept as it
 * is. Asked by process.ts with askWorker().
 */
import { sha256, toBase64Url } from '@shkriuss/crypto';
import { smallerJpeg } from '@shkriuss/ui/photos';
import { answerQuestions } from '@shkriuss/ui/worker';
import { takenFromExif } from '../lib/exif.ts';
import { QUALITY, SIZES } from '../lib/photos.ts';
import type { FromProcessor } from './process.ts';

async function process(file: File): Promise<FromProcessor> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = toBase64Url(await sha256(bytes));
  // JPEG, HEIC and other HEIF, PNG and WebP: told apart by their first bytes (audit 4 F3-3).
  const taken = takenFromExif(bytes);
  let image: ImageBitmap | null = null;
  try {
    image = await createImageBitmap(file);
  } catch {
    // Not a picture, or a kind this browser can't show (like HEIC outside Safari).
  }
  if (!image) {
    if (!file.type.startsWith('image/')) return { kind: 'not-a-photo' };
    return { kind: 'photo', hash, taken, width: null, height: null, thumb: null, view: null };
  }
  try {
    const [thumb, view] = [
      await smallerJpeg(image, SIZES.thumb, QUALITY.thumb),
      await smallerJpeg(image, SIZES.view, QUALITY.view),
    ];
    return { kind: 'photo', hash, taken, width: image.width, height: image.height, thumb, view };
  } finally {
    image.close();
  }
}

answerQuestions<File, FromProcessor>(process, { kind: 'failed' });
