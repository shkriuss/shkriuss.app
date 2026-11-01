/**
 * What an online library accepts, shared by the browser code and the Worker
 * (docs/adr/0016-online-photo-library.md). Items arrive sealed, so these are
 * shape and size checks, plus the limits that keep the bill small.
 */

/** A library's id: 32 bytes, base64url. Only the account's devices know it. */
export const LIBRARY_ID = /^[A-Za-z0-9_-]{43}$/;
/** An item's id, such as a photo's UUID. */
export const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
/** Which key sealed an item's details and parts. */
export const KEY_ID = /^[A-Za-z0-9_-]{1,16}$/;
/** Sealing adds a 12-byte IV and a 16-byte tag. */
export const SEAL_BYTES = 28;
/**
 * A deletion note's seal, "<key id>.<sealed>": made by the device that
 * deleted the item, with a key only the account's devices have, so a server
 * can't make one up (audit A-8).
 */
export const DELETION_PROOF = /^[A-Za-z0-9_-]{1,16}\.[A-Za-z0-9_-]{40,64}$/;

export const LIMITS = {
  /** One item, all its parts sealed. Cloudflare takes at most 100 MB in one request. */
  itemBytes: 95_000_000,
  /** Items per library. */
  items: 400_000,
  /** Bytes, all libraries together (1 TB is about $15 a month in R2). */
  bytes: 1_000_000_000_000,
  /**
   * Uploads per day (UTC), all libraries together, so the free plan's daily
   * requests last for every app: each upload is four Durable Object requests
   * and four row writes, of 100,000 a day each for every app together.
   */
  uploadsPerDay: 10_000,
  /**
   * Room for every library's list together, in bytes of Durable Object
   * storage: each item counts itemListBytes (a photo about 750) and each
   * deletion note NOTE_BYTES, so about 400,000 photos. Kept by LibraryGate:
   * the lists share the storage every app does (docs/adr/0017), and only
   * someone with the storage code can add to them (audit 6).
   */
  listBytes: 320_000_000,
  /** Sealed details, in base64url characters. */
  detailsChars: 4000,
  /** Parts per item (Photos: thumbnail, screen-sized copy, original). */
  parts: 4,
  /** Changes in one page. */
  page: 500,
  /** First parts (thumbnails) in one request, the biggest one, and ids in one "remove". */
  firstParts: 40,
  firstPartBytes: 1_000_000,
  remove: 100,
  /**
   * Wrong storage codes per hour from one internet address (one network, for
   * IPv6), whatever the library: anyone can make up a library. Counted per
   * address, not for everyone together, so a stranger can't lock others out.
   */
  unlockTries: 20,
} as const;

/**
 * The network an address belongs to, for counting wrong storage codes: an
 * IPv4 address as it is, an IPv6 address cut to its first 64 bits (one
 * connection usually has all of those). "" when there's no address.
 */
export function callerNetwork(address: string | null): string {
  const text = (address ?? '').trim().toLowerCase();
  if (!text.includes(':')) return text;
  const [head = '', tail] = text.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const middle =
    tail === undefined ? [] : Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0');
  return [...left, ...middle, ...right]
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':');
}

/** One item in the list of changes. Parts are the sealed sizes, in the order they're stored. */
export interface ItemRow {
  id: string;
  seq: number;
  key: string;
  details: string;
  parts: number[];
  at: number;
}
/** A deleted item: its id can't be used again. */
export interface DeletedRow {
  id: string;
  seq: number;
  deleted: true;
  at: number;
  /** The deleting device's seal (DELETION_PROOF); missing in notes from before it was added. */
  proof?: string;
}
export type Row = ItemRow | DeletedRow;

export const isDeletedRow = (row: Row): row is DeletedRow => 'deleted' in row;

/** GET /api/library/changes: what changed after `since`, oldest first. */
export interface Changes {
  rows: Row[];
  /** True when there are more after these: ask again from the last one. */
  more: boolean;
  /** The newest change (0 if none). */
  seq: number;
  /** Changes when the library is deleted and started again: then start from 0. */
  epoch: string;
  /** Whether the storage code was given, so items can be added. */
  unlocked: boolean;
  /** True while a deleted library's files are still being deleted. */
  wiping: boolean;
  usage: { items: number; bytes: number; uploadsToday: number };
}

/** Sizes of an item's sealed parts, from "X-Library-Parts: 1234,0,56789"; null if they make no sense. */
export function parseParts(header: string | null): number[] | null {
  if (!header || !/^\d{1,11}(,\d{1,11}){0,3}$/.test(header)) return null;
  const parts = header.split(',').map(Number);
  // A part is empty, or sealed (at least the seal itself), and one at least isn't empty.
  if (parts.some((size) => size !== 0 && size < SEAL_BYTES)) return null;
  const total = parts.reduce((sum, size) => sum + size, 0);
  return total > 0 && total <= LIMITS.itemBytes ? parts : null;
}

/**
 * What a deletion note counts in its library's list: its two rows (the
 * change, and the id it keeps from being used again), with the longest id
 * and seal there can be. Notes stay for good (docs/adr/0016).
 */
export const NOTE_BYTES = 512;

/**
 * What an item counts in its library's list (LIMITS.listBytes): its two
 * rows, the change with its sealed details and the id, keys and numbers
 * included. Never less than NOTE_BYTES, so deleting it, which leaves a
 * note in its place, never needs more room. A photo counts about 750.
 */
export function itemListBytes(item: {
  id: string;
  key: string;
  details: string;
  parts: readonly number[];
}): number {
  const rows =
    256 + 2 * item.id.length + item.key.length + item.details.length + 12 * item.parts.length;
  return Math.max(NOTE_BYTES, rows);
}

/** Sealed details: base64url of the right size. */
export const isDetails = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 40 &&
  value.length <= LIMITS.detailsChars &&
  /^[A-Za-z0-9_-]+$/.test(value);

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

function fields(body: unknown, names: readonly string[]): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  return Object.keys(record).every((key) => names.includes(key)) ? record : null;
}

/**
 * POST /api/library/first-parts: { items: [[id, bytes], …] }, the first part
 * of each. Each id once: every part is a read from R2, which is billed, so
 * one request can't read the same one 40 times (audit 6).
 */
export function checkFirstParts(body: unknown): Checked<[string, number][]> {
  const items = fields(body, ['items'])?.['items'];
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > LIMITS.firstParts ||
    !items.every(
      (item) =>
        Array.isArray(item) &&
        item.length === 2 &&
        typeof item[0] === 'string' &&
        ITEM_ID.test(item[0]) &&
        Number.isSafeInteger(item[1]) &&
        item[1] >= SEAL_BYTES &&
        item[1] <= LIMITS.firstPartBytes,
    ) ||
    new Set(items.map((item: [string, number]) => item[0])).size !== items.length
  ) {
    return {
      ok: false,
      error: `"items" must be 1 to ${LIMITS.firstParts} pairs of an id and a size, each id once.`,
    };
  }
  return { ok: true, value: items as [string, number][] };
}

/**
 * POST /api/library/remove: { ids: […], proofs: […] }, each id with its
 * deletion note's seal (proofs are missing from versions before them).
 * Returns each id once, with its seal or null.
 */
export function checkRemove(body: unknown): Checked<[string, string | null][]> {
  const record = fields(body, ['ids', 'proofs']);
  const ids = record?.['ids'];
  const proofs = record?.['proofs'];
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > LIMITS.remove ||
    !ids.every((id) => typeof id === 'string' && ITEM_ID.test(id))
  ) {
    return { ok: false, error: `"ids" must be 1 to ${LIMITS.remove} item ids.` };
  }
  if (
    proofs !== undefined &&
    (!Array.isArray(proofs) ||
      proofs.length !== ids.length ||
      !proofs.every((proof) => typeof proof === 'string' && DELETION_PROOF.test(proof)))
  ) {
    return { ok: false, error: '"proofs" must be a deletion note\u2019s seal for each id.' };
  }
  const items = new Map<string, string | null>();
  (ids as string[]).forEach((id, index) => {
    if (!items.has(id)) items.set(id, (proofs as string[] | undefined)?.[index] ?? null);
  });
  return { ok: true, value: [...items] };
}

/** POST /api/library/unlock: { code }. */
export function checkUnlock(body: unknown): Checked<string> {
  const code = fields(body, ['code'])?.['code'];
  if (typeof code !== 'string' || code.length === 0 || code.length > 500) {
    return { ok: false, error: '"code" must be the storage code.' };
  }
  return { ok: true, value: code };
}

/** POST /api/library/move: { from: the old token }. */
export function checkMove(body: unknown): Checked<string> {
  const from = fields(body, ['from'])?.['from'];
  if (typeof from !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(from)) {
    return { ok: false, error: '"from" must be the old token.' };
  }
  return { ok: true, value: from };
}

/** The UTC day of a moment, "YYYY-MM-DD": daily limits start again at midnight UTC. */
export const utcDay = (time: number): string => new Date(time).toISOString().slice(0, 10);
