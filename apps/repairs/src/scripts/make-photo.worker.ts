/**
 * Makes picked photos smaller in a web worker, so the page never freezes on
 * big files: the photo (PHOTO_SIZES.full) and its thumbnail, saved again as
 * JPEG at the best quality that's small enough to sync. Asked by photos.ts
 * with askWorker().
 */
import { smallerJpeg } from '@shkriuss/ui/photos';
import { answerQuestions } from '@shkriuss/ui/worker';
import { MAX_PHOTO_BYTES, PHOTO_QUALITIES, PHOTO_SIZES } from '../lib/repairs.ts';
import type { MadePhoto } from './photos.ts';

/** Saved at the best quality that's small enough to sync. */
async function smallEnough(image: ImageBitmap, max: number): Promise<Blob> {
  let blob: Blob | undefined;
  for (const quality of PHOTO_QUALITIES) {
    blob = await smallerJpeg(image, max, quality);
    if (blob.size <= MAX_PHOTO_BYTES) break;
  }
  return blob as Blob;
}

async function make(file: File): Promise<MadePhoto> {
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    return { kind: 'not-a-photo' };
  }
  try {
    const [full, thumb] = await Promise.all([
      smallEnough(image, PHOTO_SIZES.full),
      smallEnough(image, PHOTO_SIZES.thumb),
    ]);
    return { kind: 'photo', full, thumb };
  } finally {
    image.close();
  }
}

answerQuestions<File, MadePhoto>(make, { kind: 'failed' });
