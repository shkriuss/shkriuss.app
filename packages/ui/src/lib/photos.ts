/**
 * Smaller copies of photos, made on the device: Photos' thumbnails and
 * screen-sized copies, and Repairs' photos. Make them in a worker
 * (askWorker() from @shkriuss/ui/worker), so a big photo never freezes the
 * page:
 *
 *   const image = await createImageBitmap(file);
 *   const thumb = await smallerJpeg(image, 320, 0.8);
 */

/** A width and height scaled down (never up) so the longest side is at most `max`. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * A JPEG copy of `image`, at most `max` pixels on its longest side, at
 * `quality` (0 to 1). Being drawn again, it leaves out what the camera wrote
 * into the file, like the location.
 */
export async function smallerJpeg(image: ImageBitmap, max: number, quality: number): Promise<Blob> {
  const { width, height } = fitWithin(image.width, image.height, max);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas.');
  context.drawImage(image, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}
