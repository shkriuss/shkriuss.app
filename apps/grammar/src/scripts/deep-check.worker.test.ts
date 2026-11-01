/**
 * The Deep check worker, with a stand-in for onnxruntime-web and for the
 * files Deep check saved: what it tells the page when the model can't
 * start, and when it fails while checking (audit 6). The real model runs
 * in e2e/deep-check.spec.ts.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  DeepCheckFile,
  DeepCheckManifest,
  FromDeepCheck,
  ToDeepCheck,
} from '../lib/deep-check.ts';

/** Whether the stand-in runtime starts. Once started, it fails at every check. */
const runtime = vi.hoisted(() => ({ starts: true }));

vi.mock('onnxruntime-web', () => ({
  env: { wasm: {} },
  // Only handed to run(), which fails.
  Tensor: class {
    readonly standIn = true;
  },
  InferenceSession: {
    create: () => {
      if (!runtime.starts) return Promise.reject(new Error('No WebAssembly here'));
      return Promise.resolve({
        outputNames: ['logits'],
        // As when a phone runs short of memory.
        run: () =>
          Promise.reject(new RangeError('WebAssembly.Memory.grow(): Maximum memory size exceeded')),
      });
    },
  },
}));

const sent: FromDeepCheck[] = [];
let listener: ((event: { data: ToDeepCheck }) => void) | undefined;
/** The saved files, by path (Deep check's cache). */
const saved = new Map<string, string>();

const file = (name: string): DeepCheckFile => ({
  path: `/on-demand/deep-check/${name}`,
  bytes: 1,
  sha256: '0'.repeat(64),
});
const manifest: DeepCheckManifest = {
  version: 1,
  // Read with import(): here, the stand-in above.
  runtime: { ...file('ort.mjs'), path: 'onnxruntime-web' },
  loader: file('ort.wasm.mjs'),
  wasm: file('ort.wasm'),
  vocab: file('vocab.json'),
  merges: file('merges.txt'),
  labels: file('labels.txt'),
  verbs: file('verbs.txt'),
  model: [file('model.0.onnx')],
};

/** Sends the worker a message, in a task of its own, as a browser does. */
const tell = (message: ToDeepCheck): void => {
  setTimeout(() => listener?.({ data: message }), 0);
};
/** The messages the worker sent, once it has sent `count`. */
const answers = (count: number) =>
  vi.waitFor(
    () => {
      if (sent.length < count) throw new Error(`${sent.length} of ${count} answers`);
      return [...sent];
    },
    { timeout: 5_000, interval: 10 },
  );
/** Waits a moment, for an answer that shouldn't come. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

beforeAll(async () => {
  for (const name of ['ort.wasm', 'model.0.onnx', 'labels.txt', 'verbs.txt', 'merges.txt']) {
    saved.set(`/on-demand/deep-check/${name}`, '');
  }
  saved.set('/on-demand/deep-check/vocab.json', '{}');
  vi.stubGlobal('self', { crossOriginIsolated: false });
  vi.stubGlobal('location', { origin: 'https://grammar.shkriuss.app' });
  vi.stubGlobal('caches', {
    open: () =>
      Promise.resolve({
        match: (path: string) => {
          const text = saved.get(path);
          return Promise.resolve(text === undefined ? undefined : new Response(text));
        },
      }),
  });
  vi.stubGlobal('addEventListener', (type: string, handler: typeof listener) => {
    if (type === 'message') listener = handler;
  });
  vi.stubGlobal('postMessage', (message: FromDeepCheck) => sent.push(message));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await import('./deep-check.worker.ts');
});

describe('the Deep check worker', () => {
  it('says a check failed, not that it couldn’t start, when the model fails while checking', async () => {
    // Before, any failure was "couldn't start in this browser", which sent
    // the person to update their browser.
    sent.length = 0;
    tell({ type: 'start', manifest });
    tell({ type: 'check', id: 1, sentences: [['She', 'go', 'home', '.']] });
    expect(await answers(2)).toEqual([
      { type: 'ready', threads: 1 },
      { type: 'failed', reason: 'check' },
    ]);
  });

  it('says it couldn’t start, once, when the model doesn’t start', async () => {
    sent.length = 0;
    runtime.starts = false;
    tell({ type: 'start', manifest });
    // A check sent while it starts doesn't say so a second time.
    tell({ type: 'check', id: 2, sentences: [['Hi', '.']] });
    expect(await answers(1)).toEqual([{ type: 'failed', reason: 'start' }]);
    await settle();
    expect(sent).toHaveLength(1);
  });

  it('says files are missing when one is', async () => {
    sent.length = 0;
    runtime.starts = true;
    saved.delete('/on-demand/deep-check/labels.txt');
    tell({ type: 'start', manifest });
    expect(await answers(1)).toEqual([{ type: 'failed', reason: 'files' }]);
  });
});
