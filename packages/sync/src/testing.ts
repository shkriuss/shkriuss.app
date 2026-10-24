/**
 * For tests:
 *
 * - memorySync(): an app's sync server in memory: the real Worker code and
 *   Durable Objects (@shkriuss/server/testing), with each copy's storage in
 *   a Map. `copies.runAlarms()` wakes the copies whose alarm is due.
 * - footprint() and sampleText(): how much room an app's data takes on the
 *   device and in the sync copy, for tests that set an app's item limits
 *   (audit F2-8).
 */
import { createWorker, type DurableObjectNamespace } from '@shkriuss/server';
import { memoryNamespace } from '@shkriuss/server/testing';
import { knownFrom, observe, type Identified } from './merge.ts';
import { SYNC_FORMAT, SYNC_VERSION, sealStores } from './snapshot.ts';
import worker, { SyncCopy, syncHandler, type SyncEnv } from './worker.ts';

/** An app's Worker with files on (worker.ts's default has them off). */
export const withFiles = createWorker<SyncEnv>({ '/api/sync': syncHandler({ files: true }) });

export function memorySync() {
  const env: SyncEnv = {
    ASSETS: { fetch: async () => new Response('page') },
    SYNC_COPIES: null as unknown as DurableObjectNamespace,
  };
  const copies = memoryNamespace((state) => new SyncCopy(state, env));
  env.SYNC_COPIES = copies.namespace;
  return {
    env,
    copies,
    fetch: (request: Request) => worker.fetch(request, env),
    fetchWithFiles: (request: Request) => withFiles.fetch(request, env),
  };
}

/** How much room a store's data takes (footprint). */
export interface Footprint {
  /** Characters the store saves on the device (in localStorage). */
  saved: number;
  /**
   * Characters sync keeps on the device besides, while it's on: what it
   * knew at the last sync and what's online (each item's fingerprint and
   * time, twice). Only letters and digits, so they count once everywhere.
   */
  syncState: number;
  /** Bytes of the copy that goes online, compressed (before it's sealed). */
  compressed: number;
  /** Characters of the sealed copy: at most MAX_SEALED_CHARS (./validate.ts). */
  sealed: number;
}

/**
 * How much room a store's data takes, measured with the real sync code.
 * `data` is the store's whole value and `items` its list, as the app saves
 * them; `deleted` adds that many deletion markers, which sync keeps for 180
 * days after items are deleted (say, a whole year of them).
 */
export async function footprint(options: {
  app: string;
  /** The store's full key ("shkriuss:budget"). */
  store: string;
  version: number;
  data: unknown;
  items: readonly Identified[];
  deleted?: number;
}): Promise<Footprint> {
  const { app, store, version, items, deleted = 0 } = options;
  const now = Date.UTC(2026, 9, 21);
  const gone = Array.from({ length: deleted }, () => ({ id: crypto.randomUUID() }));
  // Synced once with the deleted items, then once without them.
  const empty = { items: {}, order: { ids: [] as string[], t: 0 } };
  const first = observe(empty, [...items, ...gone], version, now).snapshot;
  const { snapshot } = observe(knownFrom(first), items, version, now + 1);
  // Items were changed at different times, over years (times all the same would compress too well).
  snapshot.order.ids.forEach((id, index) => {
    const entry = snapshot.items[id];
    if (entry) entry.t -= index * 7_919_000;
  });
  const stores = { [store]: snapshot };
  const known = knownFrom(snapshot);
  const file = { format: SYNC_FORMAT, version: SYNC_VERSION, app, stores, written: 1 };
  const compressed = new Response(
    new Blob([JSON.stringify(file)]).stream().pipeThrough(new CompressionStream('gzip')),
  );
  const key = crypto.getRandomValues(new Uint8Array(32));
  return {
    saved: JSON.stringify({ v: version, data: options.data }).length,
    syncState: JSON.stringify({ known: { [store]: known }, base: { stores: { [store]: known } } })
      .length,
    compressed: (await compressed.arrayBuffer()).byteLength,
    sealed: (await sealStores(key, app, stores, 1)).length,
  };
}

const SYLLABLES = (
  'ba be bi bo da de di do ka ke ki ko la le li lo ma me mi mo ' +
  'na ne ni no ra re ri ro sa se si so ta te ti to va ve vi vo'
).split(' ');

/**
 * Text `length` characters long, like a person's note: words that differ
 * from one `seed` to the next, and that compress no better than real ones.
 */
export function sampleText(length: number, seed: number): string {
  // mulberry32: small, and the same numbers for the same seed everywhere.
  let state = seed | 0;
  const next = (count: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return Math.floor((((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296) * count);
  };
  let text = '';
  while (text.length < length) {
    const syllables = Array.from({ length: 1 + next(3) }, () => SYLLABLES[next(SYLLABLES.length)]);
    text += `${syllables.join('')} `;
  }
  return text.slice(0, length - 1) + '.';
}
