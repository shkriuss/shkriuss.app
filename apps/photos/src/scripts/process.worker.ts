/**
 * Reads picked photos in a web worker, so the page never freezes on big
 * files: the original's SHA-256 (to spot a photo added twice), when it was
 * taken (Exif), and two JPEG copies made smaller, a thumbnail for the grid
 * and one for looking at it on a screen. The original itself is kept as it
 * is. Started by photos.ts with startWorker().
 */
import { sha256, toBase64Url } from '@shkriuss/crypto';
import { takenFromExif } from '../lib/exif.ts';
import { fitWithin, QUALITY, SIZES } from '../lib/photos.ts';
import type { FromProcessor, ToProcessor } from './process.ts';

async function smaller(image: ImageBitmap, max: number, quality: number): Promise<Blob> {
  const { width, height } = fitWithin(image.width, image.height, max);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas.');
  context.drawImage(image, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

async function process(file: File): Promise<FromProcessor> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = toBase64Url(await sha256(bytes));
  const taken = file.type === 'image/jpeg' || file.type === '' ? takenFromExif(bytes) : null;
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
      await smaller(image, SIZES.thumb, QUALITY.thumb),
      await smaller(image, SIZES.view, QUALITY.view),
    ];
    return { kind: 'photo', hash, taken, width: image.width, height: image.height, thumb, view };
  } finally {
    image.close();
  }
}

addEventListener('message', (event: MessageEvent<ToProcessor>) => {
  const { id, file } = event.data;
  process(file)
    .catch((): FromProcessor => ({ kind: 'failed' }))
    .then((result) => postMessage({ ...result, id }));
});
