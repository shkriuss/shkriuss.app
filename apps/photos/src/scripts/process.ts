/**
 * Talking to the worker that reads picked photos (process.worker.ts): one
 * file at a time, in the order asked.
 */
import { startWorker } from '@shkriuss/ui/worker';
import processorUrl from './process.worker.ts?worker&url';

export interface ToProcessor {
  id: number;
  file: File;
}

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

let worker: Worker | null = null;
let lastId = 0;
const waiting = new Map<number, (result: FromProcessor) => void>();

function started(): Worker {
  if (worker) return worker;
  const created = startWorker(processorUrl);
  created.addEventListener('message', (event: MessageEvent<FromProcessor & { id: number }>) => {
    const { id, ...result } = event.data;
    waiting.get(id)?.(result as FromProcessor);
    waiting.delete(id);
  });
  created.addEventListener('error', () => {
    // Nothing more will come back: let everyone waiting carry on.
    for (const done of waiting.values()) done({ kind: 'failed' });
    waiting.clear();
    worker = null;
  });
  worker = created;
  return created;
}

/** Reads one picked file (see process.worker.ts). */
export function processFile(file: File): Promise<FromProcessor> {
  lastId += 1;
  const id = lastId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    started().postMessage({ id, file } satisfies ToProcessor);
  });
}
