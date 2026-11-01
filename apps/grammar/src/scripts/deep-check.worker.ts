/**
 * Grammar's Deep check, in a web worker so the page never freezes. It loads
 * onnxruntime-web and the GECToR model from the files Deep check downloaded
 * (saved on this device), then corrects sentences here. Nothing is sent
 * anywhere. Started by deep-check.ts with startWorker().
 *
 * The model runs on up to 4 processor cores ("threads"), each a worker of
 * its own that onnxruntime-web starts from its loader file; allowThreadScripts()
 * lets it do that under our Trusted Types policy (docs/adr/0012).
 */
import type * as Ort from 'onnxruntime-web';
import { allowThreadScripts } from '@shkriuss/ui/worker';
import { Bpe } from '../lib/bpe.ts';
import {
  DEEP_CHECK_CACHE,
  type DeepCheckFile,
  type DeepCheckManifest,
  type FromDeepCheck,
  type ToDeepCheck,
} from '../lib/deep-check.ts';
import {
  correct,
  parseLabels,
  parseVerbForms,
  predictions,
  type Prediction,
} from '../lib/gector.ts';

const MAX_THREADS = 4;

interface Model {
  ort: typeof Ort;
  session: Ort.InferenceSession;
  bpe: Bpe;
  labels: string[];
  verbs: Map<string, string>;
}

const send = (message: FromDeepCheck): void => {
  postMessage(message);
};

class MissingFile extends Error {}

/** Loads everything from the saved files (they were checked when downloaded). */
async function load(manifest: DeepCheckManifest, threads: number): Promise<Model> {
  const cache = await caches.open(DEEP_CHECK_CACHE);
  const saved = async (file: DeepCheckFile): Promise<Response> => {
    const response = await cache.match(file.path);
    if (!response) throw new MissingFile(file.path);
    return response;
  };
  const text = async (file: DeepCheckFile) => (await saved(file)).text();

  const bpe = new Bpe(
    JSON.parse(await text(manifest.vocab)) as Record<string, number>,
    await text(manifest.merges),
  );
  const labels = parseLabels(await text(manifest.labels));
  const verbs = parseVerbForms(await text(manifest.verbs));
  const wasmBinary = await (await saved(manifest.wasm)).arrayBuffer();

  // The model's parts, joined back into one file.
  const model = new Uint8Array(manifest.model.reduce((total, part) => total + part.bytes, 0));
  let offset = 0;
  for (const part of manifest.model) {
    const bytes = new Uint8Array(await (await saved(part)).arrayBuffer());
    model.set(bytes, offset);
    offset += bytes.byteLength;
  }

  const loader = new URL(manifest.loader.path, location.origin).href;
  if (threads > 1) allowThreadScripts([loader]);
  const ort = (await import(/* @vite-ignore */ manifest.runtime.path)) as typeof Ort;
  ort.env.logLevel = 'error';
  ort.env.wasm.wasmPaths = { mjs: loader };
  ort.env.wasm.wasmBinary = wasmBinary;
  ort.env.wasm.numThreads = threads;
  ort.env.wasm.proxy = false;
  const session = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return { ort, session, bpe, labels, verbs };
}

/** The model's best label (and how sure it is) for "$START" and each word. */
async function predict(model: Model, words: readonly string[]): Promise<Prediction[]> {
  const { ort, session, bpe, labels } = model;
  const { ids, starts } = bpe.encodeWords(words);
  const shape = [1, ids.length];
  const feeds = {
    input_ids: new ort.Tensor(
      'int64',
      BigInt64Array.from(ids, (id) => BigInt(id)),
      shape,
    ),
    attention_mask: new ort.Tensor('int64', new BigInt64Array(ids.length).fill(1n), shape),
  };
  const results = await session.run(feeds);
  const logits = results[session.outputNames[0] ?? 'logits'];
  if (!logits) throw new Error('The model gave no answer');
  const found = predictions(logits.data as Float32Array, labels.length, starts);
  logits.dispose();
  return found;
}

let model: Promise<Model> | undefined;
/** Only the newest check is worth finishing. */
let newest = 0;
/** Checks run one at a time (the model can't run two at once). */
let queue = Promise.resolve();

async function check(id: number, sentences: string[][]): Promise<void> {
  if (id !== newest || !model) return;
  // Didn't start: the start's own answer says so (once).
  const loaded = await model.catch(() => undefined);
  if (!loaded) return;
  const corrected: string[][] = [];
  for (const [index, words] of sentences.entries()) {
    if (id !== newest) return;
    corrected.push(
      await correct(words, (current) => predict(loaded, current), loaded.labels, loaded.verbs),
    );
    send({ type: 'progress', id, done: index + 1, total: sentences.length });
  }
  send({ type: 'checked', id, corrected });
}

addEventListener('message', (event: MessageEvent<ToDeepCheck>) => {
  const message = event.data;
  if (message.type === 'start') {
    const threads = self.crossOriginIsolated
      ? Math.max(1, Math.min(MAX_THREADS, navigator.hardwareConcurrency || 1))
      : 1;
    model = load(message.manifest, threads);
    model.then(
      () => {
        send({ type: 'ready', threads });
      },
      (error: unknown) => {
        console.error('Deep check couldn’t start:', error);
        send({ type: 'failed', reason: error instanceof MissingFile ? 'files' : 'start' });
      },
    );
  } else {
    newest = message.id;
    queue = queue
      .then(() => check(message.id, message.sentences))
      .catch((error: unknown) => {
        // It started, then failed while checking (short of memory, say): not
        // "couldn't start in this browser", which sent people to update it.
        console.error('Deep check failed while checking:', error);
        send({ type: 'failed', reason: 'check' });
      });
  }
});
