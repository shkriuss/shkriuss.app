/**
 * The copy of an app's data that travels between devices: the merge snapshot
 * of every synced store (./merge.ts), as JSON, compressed, then sealed with
 * AES-256-GCM using a key only the account's devices have. The server stores
 * only the sealed text. Files, like photos, are sealed one by one with the
 * same key (fileLabel).
 */
import { hkdf, open, seal, toBase64Url, utf8 } from '@shkriuss/crypto';
import type { StoreSnapshot } from './merge.ts';

export const SYNC_FORMAT = 'shkriuss-sync';
export const SYNC_VERSION = 1;

/** Every synced store of an app, by store key (e.g. "shkriuss:calendar"). */
export type Stores = Record<string, StoreSnapshot>;

interface SyncFile {
  format: typeof SYNC_FORMAT;
  version: typeof SYNC_VERSION;
  app: string;
  stores: Stores;
  /**
   * How many times devices have written the copy. It's sealed, so a server
   * can't pass an old copy off as a new one (audit A-8). Copies written
   * before it was added don't have it.
   */
  written?: number;
}

/** An opened copy: its stores, and how many times it was written (null if it doesn't say). */
export interface OpenedCopy {
  stores: Stores;
  written: number | null;
}

/** The two keys an app's own key gives: one for the server (a token), one for the data. */
export async function syncKeys(
  appSecret: Uint8Array<ArrayBuffer>,
): Promise<{ token: string; key: Uint8Array<ArrayBuffer> }> {
  return {
    token: toBase64Url(await hkdf(appSecret, 'shkriuss sync token v1')),
    key: await hkdf(appSecret, 'shkriuss sync key v1'),
  };
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: GenericTransformStream) {
  const output = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

const label = (app: string) => `shkriuss sync v1 ${app}`;

/**
 * What a file (like a photo) is sealed with, along with the data key: the
 * app and the file's id, so the server can't pass one file off as another.
 */
export const fileLabel = (app: string, id: string) => `shkriuss sync file v1 ${app} ${id}`;

export async function sealStores(
  key: Uint8Array<ArrayBuffer>,
  app: string,
  stores: Stores,
  written: number,
): Promise<string> {
  const file: SyncFile = { format: SYNC_FORMAT, version: SYNC_VERSION, app, stores, written };
  const compressed = await pipe(utf8(JSON.stringify(file)), new CompressionStream('gzip'));
  return seal(key, compressed, label(app));
}

/** Opens a sealed copy. Throws if the key is wrong, it was changed, or it isn't this app's. */
export async function openStores(
  key: Uint8Array<ArrayBuffer>,
  app: string,
  sealed: string,
): Promise<OpenedCopy> {
  const compressed = await open(key, sealed, label(app));
  const file = JSON.parse(
    new TextDecoder().decode(await pipe(compressed, new DecompressionStream('gzip'))),
  ) as Partial<SyncFile>;
  if (file.format !== SYNC_FORMAT || file.app !== app || typeof file.stores !== 'object') {
    throw new Error('Not this app’s sync data');
  }
  if (file.version !== SYNC_VERSION) throw new RangeError('Made by a newer version');
  const { written } = file;
  return {
    stores: file.stores ?? {},
    written: Number.isSafeInteger(written) && (written as number) > 0 ? (written as number) : null,
  };
}
