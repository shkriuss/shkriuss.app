/**
 * An app's online library, browser side (docs/adr/0016-online-photo-library.md).
 * The app keeps its own list of what's in it (Photos: its photo database)
 * and drives it; this does the rest:
 *
 *   const access = await libraryAccess(sync.secret(), record);  // keys and token
 *   const api = libraryApi(access);
 *   await api.changes(since);           // what changed, details opened
 *   await api.upload(id, details, parts);
 *   await api.firstParts([...]);        // thumbnails, several at once
 *
 * Every key comes from the app's own key from the account (sync). The
 * library's id and the keys its items were sealed with are kept in the
 * app's synced copy (a LibraryRecord, one per library), so they move with it
 * to a new account key; new items are always sealed with the newest key.
 * useLibrary() says which library to use.
 */
import {
  fromBase64Url,
  hkdf,
  open,
  openBytes,
  seal,
  sealBytes,
  toBase64Url,
  utf8,
} from '@shkriuss/crypto';
import type { LinkedData } from '@shkriuss/sync';
import { fetchWithLimit } from '@shkriuss/sync/request';
import { isDeletedRow, LIMITS, type Changes } from './validate.ts';

export { LIMITS } from './validate.ts';

const API = '/api/library';

// ---------- Keys ----------

export interface LibraryKey {
  /** Short, so each item can say which key sealed it. */
  id: string;
  /** 32 bytes, base64url. */
  key: string;
}

/**
 * Kept in the app's synced copy, one per library: which library, and every
 * key its items were sealed with.
 */
export interface LibraryRecord {
  /**
   * "library:" and the library's id, so a merge keeps every library's record
   * (with one record for all, the newest could replace the real library's).
   * Older versions saved one record, "library": see tidyRecords().
   */
  id: string;
  library: string;
  keys: LibraryKey[];
  /** Another device with an old account key moved it first (perhaps a lost one): it's theirs now. */
  taken?: true;
}

const recordId = (library: string) => `library:${library}`;

export const isLibraryRecord = (value: unknown): value is LibraryRecord => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record['id'] === 'library' || record['id'] === recordId(String(record['library']))) &&
    (record['taken'] === undefined || record['taken'] === true) &&
    typeof record['library'] === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(record['library']) &&
    Array.isArray(record['keys']) &&
    record['keys'].every(
      (key: unknown) =>
        typeof key === 'object' &&
        key !== null &&
        typeof (key as LibraryKey).id === 'string' &&
        typeof (key as LibraryKey).key === 'string' &&
        /^[A-Za-z0-9_-]{43}$/.test((key as LibraryKey).key),
    )
  );
};

/** What the app's own key gives: a token for the server, and the newest key for sealing. */
async function fromSecret(secret: Uint8Array<ArrayBuffer>) {
  const key = await hkdf(secret, 'shkriuss library key v1');
  return {
    token: toBase64Url(await hkdf(secret, 'shkriuss library token v1')),
    /** The library's id, if this key makes the library. */
    library: toBase64Url(await hkdf(secret, 'shkriuss library id v1')),
    key: {
      id: toBase64Url(await hkdf(key, 'shkriuss library key id v1', 9)),
      key: toBase64Url(key),
    },
  };
}

/**
 * The record to keep in the copy: a new library made from this key, or
 * `existing` with this key added if it isn't in it yet (once the library was
 * moved to it, after the account key was replaced). Two devices with the
 * same key make the same record.
 */
export async function libraryRecord(
  secret: Uint8Array<ArrayBuffer>,
  existing: LibraryRecord | undefined,
): Promise<LibraryRecord> {
  const mine = await fromSecret(secret);
  if (!existing) return { id: recordId(mine.library), library: mine.library, keys: [mine.key] };
  if (existing.keys.some((key) => key.id === mine.key.id)) return existing;
  return { ...existing, keys: [...existing.keys, mine.key] };
}

/**
 * Records as this version keeps them: one per library. The one record older
 * versions saved ("library") gets its library's id, and two records of the
 * same library become one. The same list if nothing changes.
 */
export function tidyRecords(records: readonly LibraryRecord[]): readonly LibraryRecord[] {
  const libraries = new Set(records.map((record) => record.library));
  if (
    libraries.size === records.length &&
    records.every((record) => record.id === recordId(record.library))
  ) {
    return records;
  }
  const byLibrary = new Map<string, LibraryRecord>();
  for (const record of records) {
    const known = byLibrary.get(record.library);
    const keys = known?.keys ?? [];
    const added = record.keys.filter((key) => !keys.some((other) => other.id === key.id));
    const taken = known?.taken ?? record.taken;
    byLibrary.set(record.library, {
      id: recordId(record.library),
      library: record.library,
      keys: [...keys, ...added],
      ...(taken ? { taken } : {}),
    });
  }
  return [...byLibrary.values()];
}

/** Whether a key is in the record: the library was made with it, or moved to it. */
const hasKey = (record: LibraryRecord, keyId: string) =>
  record.keys.some((key) => key.id === keyId);

/**
 * The library this app key can use, of those in `records`: one it made or
 * was moved to (a record from another account, or not moved yet, doesn't
 * have its key), and that wasn't taken. Of several, the oldest: the one that
 * has come through the most account keys, as each move adds one.
 */
export async function usableRecord(
  secret: Uint8Array<ArrayBuffer>,
  records: readonly LibraryRecord[],
): Promise<LibraryRecord | undefined> {
  const { key } = await fromSecret(secret);
  return records
    .filter((record) => !record.taken && hasKey(record, key.id))
    .sort((a, b) => b.keys.length - a.keys.length || (a.library < b.library ? -1 : 1))[0];
}

/**
 * Which library to use with this app key (usableRecord), and the records to
 * keep, tidied. When there's none, a new library is made from this key, but
 * only if `mayStart`: once a sync with the account has finished, so a
 * library that's already there isn't missed. Records come back as they
 * were if nothing changed.
 */
export async function useLibrary(
  secret: Uint8Array<ArrayBuffer>,
  records: readonly LibraryRecord[],
  mayStart: boolean,
): Promise<{ record: LibraryRecord | undefined; records: readonly LibraryRecord[] }> {
  const tidy = tidyRecords(records);
  const found = await usableRecord(secret, tidy);
  if (found || !mayStart) return { record: found, records: tidy };
  const made = await libraryRecord(secret, undefined);
  // This key's own library is there, and was taken: there's no other to make.
  if (tidy.some((record) => record.library === made.library)) {
    return { record: undefined, records: tidy };
  }
  return { record: made, records: [...tidy, made] };
}

export interface LibraryAccess {
  token: string;
  library: string;
  /** Every key the record knows, by id, for opening. */
  keys: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
  /** For sealing new items. */
  current: { id: string; key: Uint8Array<ArrayBuffer> };
}

/** How to reach the library in `record` with the app's own key. */
export async function libraryAccess(
  secret: Uint8Array<ArrayBuffer>,
  record: LibraryRecord,
): Promise<LibraryAccess> {
  const mine = await fromSecret(secret);
  const keys = new Map(record.keys.map((key) => [key.id, fromBase64Url(key.key)]));
  const current = { id: mine.key.id, key: fromBase64Url(mine.key.key) };
  keys.set(current.id, current.key);
  return { token: mine.token, library: record.library, keys, current };
}

const label = (library: string, id: string, part: string) =>
  `shkriuss library v1 ${library} ${id} ${part}`;

// ---------- Talking to the server ----------

export type LibraryProblem =
  /** No connection, or the server didn't answer. */
  | 'offline'
  /** The server refused, or what came back couldn't be read. */
  | 'server'
  /** The account key was replaced on another device. */
  | 'moved'
  /** The storage code hasn't been given for this library. */
  | 'locked'
  | 'wrong-code'
  | 'too-many-tries'
  /** The server has no storage code: nothing can be added. */
  | 'not-set-up'
  | 'full'
  /** That's all the uploads for today (see `retryAt`). */
  | 'daily-limit'
  | 'too-big'
  /** The item was deleted on another device. */
  | 'deleted'
  /** The server says the item was deleted, but no device of this account's did: it stays here. */
  | 'unproven-deletion'
  /** The item is already in the library. */
  | 'exists'
  /** The library is being deleted. */
  | 'wiping';

export class LibraryError extends Error {
  readonly problem: LibraryProblem;
  /** For 'daily-limit': when uploads can start again (ms). */
  readonly retryAt: number | null;
  /** The server's answer, if it gave one. */
  readonly status: number | null;
  /** For 'deleted': the deletion note's seal the server gave, to check. */
  readonly proof: string | null;
  constructor(
    problem: LibraryProblem,
    retryAt: number | null = null,
    status: number | null = null,
    proof: string | null = null,
  ) {
    super(problem);
    this.problem = problem;
    this.retryAt = retryAt;
    this.status = status;
    this.proof = proof;
  }
}

/** A failed response as a LibraryError, from its status and body. */
async function failure(response: Response): Promise<LibraryError> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const flag = (name: string) => body[name] === true;
  const error = (problem: LibraryProblem, retryAt: number | null = null) =>
    new LibraryError(problem, retryAt, response.status);
  if (response.status === 410) return error('moved');
  if (response.status === 423) return error('locked');
  if (response.status === 507) return error('full');
  if (response.status === 413) return error('too-big');
  if (response.status === 409 && flag('deleted')) {
    const proof = typeof body['proof'] === 'string' ? body['proof'] : null;
    return new LibraryError('deleted', null, response.status, proof);
  }
  if (response.status === 409) return error('exists');
  if (response.status === 403 && flag('wrong')) return error('wrong-code');
  if (response.status === 429) {
    if (flag('tooMany')) return error('too-many-tries');
    return error('daily-limit', typeof body['retryAt'] === 'number' ? body['retryAt'] : null);
  }
  if (response.status === 503 && flag('notSetUp')) return error('not-set-up');
  if (response.status === 503 && flag('wiping')) return error('wiping');
  return error(response.status >= 500 ? 'offline' : 'server');
}

/** "This isn't your library": this key's token isn't the library's. */
const isRefused = (error: unknown): boolean =>
  error instanceof LibraryError && error.problem === 'server' && error.status === 403;

/** An item from the list of changes, its details opened. */
export interface LibraryItem {
  id: string;
  seq: number;
  /** When it was added online (ms). */
  at: number;
  /** Which key sealed it (for reading its parts). */
  key: string;
  details: unknown;
  /** Its parts' sealed sizes, in order (0: that part is empty). */
  parts: number[];
}
export type LibraryChange = LibraryItem | { id: string; seq: number; deleted: true };

export interface LibraryChanges extends Omit<Changes, 'rows'> {
  changes: LibraryChange[];
  /** Items whose details couldn't be opened (sealed with a key this record doesn't have). */
  unreadable: number;
  /** The last change in this page, readable or not: ask for the next page after it. */
  last: number;
}

/** Where a part starts in an item's file. */
export const partOffset = (parts: readonly number[], index: number): number =>
  parts.slice(0, index).reduce((sum, size) => sum + size, 0);

async function bytesOf(part: Blob | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return part instanceof Uint8Array ? part : new Uint8Array(await part.arrayBuffer());
}

export function libraryApi(access: LibraryAccess) {
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${access.token}`);
    headers.set('X-Library', access.library);
    if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
      // With a time limit for its size, as sync's requests (audit G-11): a
      // network that hangs counts as no connection, instead of waiting for ever.
      response = await fetchWithLimit(`${API}${path}`, {
        ...init,
        headers,
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new LibraryError('offline');
    }
    if (!response.ok) throw await failure(response);
    return response;
  }
  const post = (path: string, body: unknown) =>
    call(path, { method: 'POST', body: JSON.stringify(body) });

  /** One sealed part, opened with the key that sealed its item; null if it can't be. */
  async function openPart(
    id: string,
    keyId: string,
    index: number,
    sealed: Uint8Array<ArrayBuffer>,
  ) {
    const key = access.keys.get(keyId);
    if (!key) return null;
    return openBytes(key, sealed, label(access.library, id, `part ${index}`)).catch(() => null);
  }

  /**
   * Whether a deletion note was made by a device of this account: its seal
   * opens with one of the library's keys, for this library and this item.
   * A server can't make one up, or move one to another item (audit A-8).
   */
  async function realDeletion(id: string, proof: string | null | undefined): Promise<boolean> {
    const [keyId = '', sealed = ''] = (proof ?? '').split('.');
    const key = access.keys.get(keyId);
    if (!key || sealed === '') return false;
    return open(key, sealed, label(access.library, id, 'deleted')).then(
      () => true,
      () => false,
    );
  }

  return {
    /** What changed after change `since`, oldest first (a page at a time: see `more`). */
    async changes(since: number): Promise<LibraryChanges> {
      const page = (await (await call(`/changes?since=${since}`)).json()) as Changes;
      const changes: LibraryChange[] = [];
      let unreadable = 0;
      for (const row of page.rows) {
        if (isDeletedRow(row)) {
          // A note without a device's seal is left alone: the item stays here.
          if (await realDeletion(row.id, row.proof)) {
            changes.push({ id: row.id, seq: row.seq, deleted: true });
          }
          continue;
        }
        const key = access.keys.get(row.key);
        try {
          if (!key) throw new Error('No key');
          const opened = await open(key, row.details, label(access.library, row.id, 'details'));
          const details: unknown = JSON.parse(new TextDecoder().decode(opened));
          changes.push({
            id: row.id,
            seq: row.seq,
            at: row.at,
            key: row.key,
            details,
            parts: row.parts,
          });
        } catch {
          unreadable += 1;
        }
      }
      const { rows, ...rest } = page;
      return { ...rest, changes, unreadable, last: rows.at(-1)?.seq ?? since };
    },

    /** Gives the storage code, once per library. */
    async unlock(code: string): Promise<void> {
      await post('/unlock', { code });
    },

    /**
     * Seals an item (its details, and each part on its own) and adds it.
     * Empty (null) parts stay empty. Returns its change number and its
     * parts' sealed sizes.
     */
    async upload(
      id: string,
      details: unknown,
      parts: readonly (Blob | Uint8Array<ArrayBuffer> | null)[],
    ): Promise<{ seq: number; key: string; parts: number[] }> {
      const { current, library } = access;
      const sealedDetails = await seal(
        current.key,
        utf8(JSON.stringify(details)),
        label(library, id, 'details'),
      );
      if (sealedDetails.length > LIMITS.detailsChars) throw new LibraryError('too-big');
      const sealed: Uint8Array<ArrayBuffer>[] = [];
      for (const [index, part] of parts.entries()) {
        sealed.push(
          part
            ? await sealBytes(current.key, await bytesOf(part), label(library, id, `part ${index}`))
            : new Uint8Array(0),
        );
      }
      const sizes = sealed.map((part) => part.length);
      if (sizes.reduce((sum, size) => sum + size, 0) > LIMITS.itemBytes) {
        throw new LibraryError('too-big');
      }
      const response = await call(`/items/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: new Blob(sealed),
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Library-Key': current.id,
          'X-Library-Details': sealedDetails,
          'X-Library-Parts': sizes.join(','),
        },
      }).catch(async (error: unknown) => {
        if (
          error instanceof LibraryError &&
          error.problem === 'deleted' &&
          !(await realDeletion(id, error.proof))
        ) {
          throw new LibraryError('unproven-deletion', null, error.status);
        }
        throw error;
      });
      const { seq } = (await response.json()) as { seq: number };
      return { seq, key: current.id, parts: sizes };
    },

    /**
     * Deletes items everywhere (their ids can't be used again). Each deletion
     * note carries this device's seal, so other devices can tell it's real.
     */
    async remove(ids: readonly string[]): Promise<void> {
      const { current, library } = access;
      for (let start = 0; start < ids.length; start += LIMITS.remove) {
        const chunk = ids.slice(start, start + LIMITS.remove);
        const proofs = await Promise.all(
          chunk.map(
            async (id) =>
              `${current.id}.${await seal(current.key, utf8('deleted'), label(library, id, 'deleted'))}`,
          ),
        );
        await post('/remove', { ids: chunk, proofs });
      }
    },

    /**
     * Several items' first parts (like thumbnails), opened. Items without one,
     * or whose part couldn't be read, are left out.
     */
    async firstParts(
      items: readonly { id: string; key: string; parts: readonly number[] }[],
    ): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
      const found = new Map<string, Uint8Array<ArrayBuffer>>();
      const wanted = items.filter(
        (item) => (item.parts[0] ?? 0) > 0 && (item.parts[0] ?? 0) <= LIMITS.firstPartBytes,
      );
      for (let start = 0; start < wanted.length; start += LIMITS.firstParts) {
        const batch = wanted.slice(start, start + LIMITS.firstParts);
        const response = await post('/first-parts', {
          items: batch.map((item) => [item.id, item.parts[0]]),
        });
        const bytes = new Uint8Array(await response.arrayBuffer());
        const view = new DataView(bytes.buffer);
        let at = 0;
        for (const item of batch) {
          if (at + 4 > bytes.length) break;
          const size = view.getUint32(at);
          const sealed = bytes.slice(at + 4, at + 4 + size);
          at += 4 + size;
          const opened = size > 0 ? await openPart(item.id, item.key, 0, sealed) : null;
          if (opened) found.set(item.id, opened);
        }
      }
      return found;
    },

    /** One part of an item, opened; null if it's empty, gone, or can't be read. */
    async part(
      item: { id: string; key: string; parts: readonly number[] },
      index: number,
    ): Promise<Uint8Array<ArrayBuffer> | null> {
      const size = item.parts[index] ?? 0;
      if (size === 0) return null;
      let response: Response;
      try {
        response = await call(
          `/items/${encodeURIComponent(item.id)}?offset=${partOffset(item.parts, index)}&length=${size}`,
        );
      } catch (error) {
        if (error instanceof LibraryError && error.problem === 'server') return null;
        throw error;
      }
      return openPart(item.id, item.key, index, new Uint8Array(await response.arrayBuffer()));
    },

    /** After the account key was replaced: this key's token takes over from `fromToken`. */
    async move(fromToken: string): Promise<void> {
      await post('/move', { from: fromToken });
    },

    /** Deletes everything in the library (files go over the next minutes). */
    async wipe(): Promise<void> {
      await call('', { method: 'DELETE' });
    },
  };
}

export type LibraryApi = ReturnType<typeof libraryApi>;

/**
 * For createSync's `linked` option: the libraries are deleted with the app's
 * online copy, and moved with it to a new account key. `load` reads the
 * libraries' records from the synced copy; `save` saves them there (false if
 * it couldn't).
 */
export function linkedLibrary(
  load: () => readonly LibraryRecord[],
  save: (records: readonly LibraryRecord[]) => boolean = () => true,
): LinkedData {
  return {
    async delete(secret) {
      const { key } = await fromSecret(secret);
      for (const found of tidyRecords(load())) {
        // Another account's, not moved to this key, or taken: nothing of ours to delete.
        if (found.taken || !hasKey(found, key.id)) continue;
        try {
          await libraryApi(await libraryAccess(secret, found)).wipe();
        } catch (error) {
          // Moved on to a newer key: not ours any more. Anything else, like a
          // refusal, stops the deletion: it never says it's done when it isn't.
          if (!(error instanceof LibraryError && error.problem === 'moved')) throw error;
        }
      }
    },
    /**
     * Every library the old key could reach (its record has that key), not
     * only the one in use, gets the new key's token, and the new key in its
     * record. Records without the old key can't be moved with it. A library
     * that another device with the old key moved first (perhaps the lost one)
     * is theirs: it's marked as taken, without failing, so the old copy is
     * retired all the same and the app starts a new library.
     */
    async move(from, to) {
      const old = await fromSecret(from);
      const records = tidyRecords(load());
      const moved: LibraryRecord[] = [];
      for (const found of records) {
        if (found.taken || !hasKey(found, old.key.id)) {
          moved.push(found);
          continue;
        }
        try {
          await libraryApi(await libraryAccess(to, found)).move(old.token);
          moved.push(await libraryRecord(to, found));
        } catch (error) {
          if (!isRefused(error)) throw error;
          moved.push({ ...found, taken: true });
        }
      }
      const changed = moved.some((found, index) => found !== records[index]);
      if (changed && !save(moved)) throw new Error('Couldn’t save the library’s record.');
    },
  };
}
