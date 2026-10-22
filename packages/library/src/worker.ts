/**
 * Server side of an app's online library (docs/adr/0016-online-photo-library.md),
 * in the app's own Worker:
 *
 *   GET    /api/library/changes?since=N      what changed after change N (Changes)
 *   POST   /api/library/unlock               { code }: the storage code, once per library
 *   PUT    /api/library/items/<id>           add an item: its sealed parts, one after the other
 *            (X-Library-Key: which key sealed it, X-Library-Details: its sealed
 *             details, X-Library-Parts: the parts' sizes)
 *   GET    /api/library/items/<id>?offset=N&length=N   some bytes of an item
 *   POST   /api/library/first-parts          { items: [[id, size], …] }: several first parts at once
 *   POST   /api/library/remove               { ids }: delete items (their ids can't be used again)
 *   POST   /api/library/move                 { from: old token }: after the account key was replaced
 *   DELETE /api/library                      delete everything in it
 *
 * Every request names its library (X-Library: its id) and carries a token
 * from the app's own key (Authorization: Bearer). Each library's Durable
 * Object keeps its list and checks the token; the first token to reach a
 * new library becomes its token. The files are in R2 under the SHA-256 of
 * the library's id. Everything arrives sealed, so the server can't read it.
 */
import { equalBytes, sha256, utf8 } from '@shkriuss/crypto';
import {
  API_HEADERS,
  bearerToken,
  createWorker,
  json,
  jsonBody,
  noContent,
  problem,
  sha256Text,
  type DurableObjectListState,
  type DurableObjectNamespace,
  type R2Bucket,
  type SiteEnv,
} from '@shkriuss/server';
import {
  checkFirstParts,
  checkMove,
  checkRemove,
  checkUnlock,
  isDetails,
  ITEM_ID,
  KEY_ID,
  LIBRARY_ID,
  LIMITS,
  parseParts,
  utcDay,
  type Changes,
  type DeletedRow,
  type ItemRow,
  type Row,
} from './validate.ts';

export interface LibraryEnv extends SiteEnv {
  LIBRARIES: DurableObjectNamespace;
  LIBRARY_FILES: R2Bucket;
  /** The storage code that lets a library be added to (a secret). Without it, nothing can be. */
  LIBRARY_STORAGE_CODE?: string;
}

/** JSON bodies: a list of ids, at most. */
const MAX_JSON_BYTES = 8 * 1024;
/** First parts read from R2 at once, so a request never holds many in memory. */
const FIRST_PARTS_AT_ONCE = 8;

const fileKey = (prefix: string, id: string) => `${prefix}/${id}`;

/** The storage code, compared in constant time (as hashes, so the lengths match). */
async function isStorageCode(given: string, code: string): Promise<boolean> {
  return equalBytes(await sha256(utf8(given)), await sha256(utf8(code)));
}

/** Requests to /api/library and /api/library/*. */
export async function handleLibrary(
  request: Request,
  env: LibraryEnv,
  path: string,
): Promise<Response> {
  const token = bearerToken(request);
  if (!token) return problem(401, 'Missing or malformed token.');
  const library = request.headers.get('X-Library') ?? '';
  if (!LIBRARY_ID.test(library)) return problem(400, 'Missing or malformed library id.');
  const prefix = await sha256Text(library);
  const object = env.LIBRARIES.get(env.LIBRARIES.idFromName(library));
  // The Durable Object gets only hashes: never the token or the library's id.
  const headers = { 'X-Token': await sha256Text(token), 'X-Prefix': prefix };
  const call = (op: string, body?: unknown) =>
    object.fetch(`https://library/${op}`, {
      method: 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const body = async <T>(
    check: (body: unknown) => { ok: true; value: T } | { ok: false; error: string },
  ) => {
    const read = await jsonBody(request, MAX_JSON_BYTES);
    if (!read.ok) return read.response;
    const checked = check(read.body);
    return checked.ok ? checked : problem(400, checked.error);
  };

  if (path === '/api/library') {
    if (request.method !== 'DELETE') return problem(405, 'Use DELETE.');
    return call('wipe');
  }
  if (path === '/api/library/changes') {
    if (request.method !== 'GET') return problem(405, 'Use GET.');
    const since = Number(new URL(request.url).searchParams.get('since') ?? '0');
    if (!Number.isSafeInteger(since) || since < 0) {
      return problem(400, '"since" must be a change number.');
    }
    return call(`changes?since=${since}`);
  }
  if (path === '/api/library/unlock' || path === '/api/library/remove') {
    if (request.method !== 'POST') return problem(405, 'Use POST.');
    if (path === '/api/library/remove') {
      const ids = await body(checkRemove);
      return ids instanceof Response ? ids : call('remove', { ids: ids.value });
    }
    const code = env.LIBRARY_STORAGE_CODE;
    if (!code) return json({ error: 'Online storage isn’t set up.', notSetUp: true }, 503);
    const given = await body(checkUnlock);
    if (given instanceof Response) return given;
    return call(`unlock?ok=${(await isStorageCode(given.value, code)) ? 1 : 0}`);
  }
  if (path === '/api/library/move') {
    if (request.method !== 'POST') return problem(405, 'Use POST.');
    const from = await body(checkMove);
    if (from instanceof Response) return from;
    return call('move', { from: await sha256Text(from.value) });
  }
  if (path === '/api/library/first-parts') {
    if (request.method !== 'POST') return problem(405, 'Use POST.');
    const items = await body(checkFirstParts);
    if (items instanceof Response) return items;
    const allowed = await call('check');
    if (!allowed.ok) return allowed;
    return new Response(firstParts(env.LIBRARY_FILES, prefix, items.value), {
      headers: { 'Content-Type': 'application/octet-stream', ...API_HEADERS },
    });
  }

  const item = /^\/api\/library\/items\/([^/]+)$/.exec(path)?.[1];
  if (item === undefined) return problem(404, 'Not found.');
  if (!ITEM_ID.test(item)) return problem(400, 'Not an item id.');
  const key = fileKey(prefix, item);

  if (request.method === 'GET') {
    const query = new URL(request.url).searchParams;
    const offset = Number(query.get('offset') ?? '');
    const length = Number(query.get('length') ?? '');
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 1 ||
      offset + length > LIMITS.itemBytes
    ) {
      return problem(400, '"offset" and "length" must say which bytes.');
    }
    const allowed = await call('check');
    if (!allowed.ok) return allowed;
    const file = await env.LIBRARY_FILES.get(key, { range: { offset, length } });
    if (!file) return problem(404, 'No such item.');
    return new Response(file.body, {
      headers: { 'Content-Type': 'application/octet-stream', ...API_HEADERS },
    });
  }

  if (request.method !== 'PUT') return problem(405, 'Use GET or PUT.');
  const size = Number(request.headers.get('Content-Length') ?? '');
  const parts = parseParts(request.headers.get('X-Library-Parts'));
  if (!parts || parts.reduce((sum, part) => sum + part, 0) !== size || !request.body) {
    return problem(400, 'The parts must add up to the body.');
  }
  const keyId = request.headers.get('X-Library-Key') ?? '';
  const details = request.headers.get('X-Library-Details');
  if (!KEY_ID.test(keyId) || !isDetails(details)) {
    return problem(400, 'Missing or malformed key or details.');
  }
  // Checked before anything reaches R2, and again after (another upload may have come first).
  const begin = await call('begin', { id: item, size });
  if (!begin.ok) return begin;
  try {
    await env.LIBRARY_FILES.put(key, request.body);
  } catch {
    return problem(502, 'The upload didn’t finish.');
  }
  const commit = await call('commit', { id: item, key: keyId, details, parts });
  if (commit.headers.get('X-Discard') === '1') {
    await env.LIBRARY_FILES.delete(key).catch(() => undefined);
  }
  return commit;
}

/** A 4-byte big-endian length. */
function lengthOf(size: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, size);
  return bytes;
}

/**
 * Each item's first `size` bytes, in the order asked: 4 bytes of length (0
 * when there's no such item), then the bytes. A few are read at a time.
 */
function firstParts(
  bucket: R2Bucket,
  prefix: string,
  items: readonly [string, number][],
): ReadableStream<Uint8Array> {
  let next = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (next >= items.length) {
        controller.close();
        return;
      }
      const batch = items.slice(next, next + FIRST_PARTS_AT_ONCE);
      next += batch.length;
      const found = await Promise.all(
        batch.map(async ([id, size]) => {
          const file = await bucket
            .get(fileKey(prefix, id), { range: { offset: 0, length: size } })
            .catch(() => null);
          return file ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(0);
        }),
      );
      for (const bytes of found) {
        controller.enqueue(lengthOf(bytes.length));
        if (bytes.length > 0) controller.enqueue(bytes);
      }
    },
  });
}

export default createWorker<LibraryEnv>({ '/api/library': handleLibrary });

// ---------- One library's list ----------

interface Meta {
  /** SHA-256 of the token that may use it (null until the first request). */
  access: string | null;
  /** Tokens of replaced account keys: refused, saying the library moved. */
  retired: string[];
  /** Where its files are in R2. */
  prefix: string;
  /** The storage code was given: items can be added. */
  unlocked: boolean;
  /** The newest change's number. */
  seq: number;
  /** Changes when the library is deleted, so devices start again. */
  epoch: string;
  items: number;
  bytes: number;
  /** Uploads on `day` (UTC). */
  day: string;
  uploads: number;
  /** Wrong storage codes since `start` (ms). */
  tries: { start: number; count: number };
  /** Being deleted: files go in batches (alarm). */
  wiping: boolean;
}

/** What the list knows of each item it ever had. */
type Entry = { seq: number; size: number } | { seq: number; deleted: true };

const HOUR_MS = 60 * 60 * 1000;
/** Old tokens remembered (one per replaced account key). */
const MAX_RETIRED = 10;
/** R2 deletes at most this many files at once. */
const DELETE_BATCH = 1000;

const seqKey = (seq: number) => `seq:${String(seq).padStart(16, '0')}`;
const itemKey = (id: string) => `item:${id}`;
const nextUtcMidnight = (now: number) => {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
};

const newMeta = (prefix: string): Meta => ({
  access: null,
  retired: [],
  prefix,
  unlocked: false,
  seq: 0,
  epoch: crypto.randomUUID(),
  items: 0,
  bytes: 0,
  day: '',
  uploads: 0,
  tries: { start: 0, count: 0 },
  wiping: false,
});

/** A refusal for an upload, and whether the file just uploaded should be deleted. */
const refusal = (status: number, body: Record<string, unknown>, discard = true): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...API_HEADERS,
      ...(discard ? { 'X-Discard': '1' } : {}),
    },
  });

export class Library {
  readonly state: DurableObjectListState;
  readonly env: LibraryEnv;

  constructor(state: DurableObjectListState, env: LibraryEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    // One request at a time: counts and change numbers stay right.
    return this.state.blockConcurrencyWhile(async () => {
      const url = new URL(request.url);
      const op = url.pathname.slice(1);
      const token = request.headers.get('X-Token') ?? '';
      const now = Date.now();
      const meta =
        (await this.state.storage.get<Meta>('meta')) ??
        newMeta(request.headers.get('X-Prefix') ?? '');

      if (meta.retired.includes(token)) {
        return json({ error: 'The library moved to a new account key.', moved: true }, 410);
      }
      if (op === 'move') {
        return this.#move(meta, token, ((await request.json()) as { from: string }).from);
      }
      if (meta.access === null) {
        meta.access = token;
        await this.#save(meta);
      } else if (meta.access !== token) {
        return problem(403, 'This isn’t your library.');
      }

      switch (op) {
        case 'check':
          return noContent();
        case 'changes':
          return this.#changes(meta, Number(url.searchParams.get('since')), now);
        case 'unlock':
          return this.#unlock(meta, url.searchParams.get('ok') === '1', now);
        case 'begin': {
          const { id, size } = (await request.json()) as { id: string; size: number };
          return (await this.#refuse(meta, id, size, now)) ?? noContent();
        }
        case 'commit':
          return this.#commit(meta, (await request.json()) as Omit<ItemRow, 'seq' | 'at'>, now);
        case 'remove':
          return this.#remove(meta, ((await request.json()) as { ids: string[] }).ids, now);
        case 'wipe':
          return this.#wipe(meta);
        default:
          return problem(404, 'Not found.');
      }
    });
  }

  /** Files are deleted in batches until none are left; then the list is emptied. */
  async alarm(): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      const meta = await this.state.storage.get<Meta>('meta');
      if (!meta?.wiping) return;
      const files = this.env.LIBRARY_FILES;
      const listed = await files.list({ prefix: `${meta.prefix}/`, limit: DELETE_BATCH });
      if (listed.objects.length > 0) await files.delete(listed.objects.map((file) => file.key));
      if (listed.truncated) {
        await this.state.storage.setAlarm(Date.now());
        return;
      }
      await this.state.storage.deleteAll();
      // Change numbers keep growing; the new epoch tells devices to start again.
      await this.#save({ ...meta, epoch: crypto.randomUUID(), items: 0, bytes: 0, wiping: false });
    });
  }

  #save(meta: Meta): Promise<void> {
    return this.state.storage.put('meta', meta);
  }

  async #changes(meta: Meta, since: number, now: number): Promise<Response> {
    const listed = meta.wiping
      ? []
      : [
          ...(
            await this.state.storage.list<Row>({
              prefix: 'seq:',
              startAfter: seqKey(since),
              limit: LIMITS.page + 1,
            })
          ).values(),
        ];
    return json({
      rows: listed.slice(0, LIMITS.page),
      more: listed.length > LIMITS.page,
      seq: meta.seq,
      epoch: meta.epoch,
      unlocked: meta.unlocked,
      wiping: meta.wiping,
      usage: {
        items: meta.items,
        bytes: meta.bytes,
        uploadsToday: meta.day === utcDay(now) ? meta.uploads : 0,
      },
    } satisfies Changes);
  }

  async #unlock(meta: Meta, ok: boolean, now: number): Promise<Response> {
    const tries = now - meta.tries.start < HOUR_MS ? meta.tries : { start: now, count: 0 };
    if (tries.count >= LIMITS.unlockTries) {
      return json({ error: 'Too many wrong codes; try again in an hour.', tooMany: true }, 429);
    }
    if (ok) {
      await this.#save({ ...meta, unlocked: true, tries: { start: now, count: 0 } });
      return noContent();
    }
    await this.#save({ ...meta, tries: { ...tries, count: tries.count + 1 } });
    return json({ error: 'That isn’t the storage code.', wrong: true }, 403);
  }

  /** Why an item of `size` bytes can't be added now, or null if it can. */
  async #refuse(meta: Meta, id: string, size: number, now: number): Promise<Response | null> {
    if (meta.wiping) return refusal(503, { error: 'The library is being deleted.', wiping: true });
    if (!meta.unlocked)
      return refusal(423, { error: 'Give the storage code first.', locked: true });
    const entry = await this.state.storage.get<Entry>(itemKey(id));
    if (entry && 'deleted' in entry) {
      return refusal(409, { error: 'That item was deleted.', deleted: true });
    }
    // Already there: its file is in use, so it stays.
    if (entry) return refusal(409, { error: 'That item is already there.', exists: true }, false);
    if (size > LIMITS.itemBytes) return refusal(413, { error: 'That item is too big.' });
    if (meta.items >= LIMITS.items || meta.bytes + size > LIMITS.bytes) {
      return refusal(507, { error: 'The library is full.', full: true });
    }
    if (meta.day === utcDay(now) && meta.uploads >= LIMITS.uploadsPerDay) {
      return refusal(429, {
        error: 'That’s all the uploads for today.',
        retryAt: nextUtcMidnight(now),
      });
    }
    return null;
  }

  async #commit(meta: Meta, item: Omit<ItemRow, 'seq' | 'at'>, now: number): Promise<Response> {
    const size = item.parts.reduce((sum, part) => sum + part, 0);
    const refused = await this.#refuse(meta, item.id, size, now);
    if (refused) return refused;
    const seq = meta.seq + 1;
    const today = utcDay(now);
    const row: ItemRow = { ...item, seq, at: now };
    await this.state.storage.put(seqKey(seq), row);
    await this.state.storage.put(itemKey(item.id), { seq, size } satisfies Entry);
    await this.#save({
      ...meta,
      seq,
      items: meta.items + 1,
      bytes: meta.bytes + size,
      day: today,
      uploads: (meta.day === today ? meta.uploads : 0) + 1,
    });
    return json({ seq });
  }

  /** Deletes items and their files, leaving markers so other devices delete them too. */
  async #remove(meta: Meta, ids: readonly string[], now: number): Promise<Response> {
    if (meta.wiping) return problem(503, 'The library is being deleted.');
    const entries = await Promise.all(
      ids.map(async (id) => [id, await this.state.storage.get<Entry>(itemKey(id))] as const),
    );
    const live = entries.filter(
      (pair): pair is readonly [string, { seq: number; size: number }] =>
        pair[1] !== undefined && !('deleted' in pair[1]),
    );
    // Files first: if that fails, nothing changes and the device tries again.
    if (live.length > 0) {
      await this.env.LIBRARY_FILES.delete(live.map(([id]) => fileKey(meta.prefix, id)));
    }
    let { seq, items, bytes } = meta;
    for (const [id, entry] of entries) {
      if (entry && 'deleted' in entry) continue;
      if (entry) {
        await this.state.storage.delete(seqKey(entry.seq));
        items -= 1;
        bytes -= entry.size;
      }
      seq += 1;
      await this.state.storage.put(seqKey(seq), {
        id,
        seq,
        deleted: true,
        at: now,
      } satisfies DeletedRow);
      await this.state.storage.put(itemKey(id), { seq, deleted: true } satisfies Entry);
    }
    await this.#save({ ...meta, seq, items, bytes });
    return noContent();
  }

  /**
   * After the account key was replaced: the new token takes over, proven
   * with the old one, which is refused from then on. Asking again is fine.
   */
  async #move(meta: Meta, token: string, from: string): Promise<Response> {
    if (meta.access === token) return noContent();
    if (meta.access !== null && meta.access !== from) {
      return problem(403, 'This isn’t your library.');
    }
    const retired =
      meta.access === from ? [...meta.retired, from].slice(-MAX_RETIRED) : meta.retired;
    await this.#save({ ...meta, access: token, retired });
    return noContent();
  }

  async #wipe(meta: Meta): Promise<Response> {
    if (!meta.wiping) await this.#save({ ...meta, wiping: true });
    await this.state.storage.setAlarm(Date.now());
    return json({ wiping: true }, 202);
  }
}
