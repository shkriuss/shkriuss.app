/**
 * Talking to the worker that reads picked photos (process.worker.ts), with
 * askWorker() from @shkriuss/ui/worker.
 */
import { askWorker, startWorker } from '@shkriuss/ui/worker';
import processorUrl from './process.worker.ts?worker&url';

export type FromProcessor =
  | {
      kind: 'photo';
      /** SHA-256 of the original, base64url. */
      hash: string;
      /** From what the camera wrote in the file, if anything. */
      taken: string | null;
      /** Null when this browser can't show the picture (then there are no copies either). */
      width: number | null;
      height: number | null;
      thumb: Blob | null;
      view: Blob | null;
    }
  | { kind: 'not-a-photo' }
  | { kind: 'failed' };

/** Reads one picked file (see process.worker.ts). */
export const processFile = askWorker<File, FromProcessor>(() => startWorker(processorUrl), {
  kind: 'failed',
});
