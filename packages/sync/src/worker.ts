/**
 * Server side of syncing an app (docs/adr/0010). Runs in the app's own
 * Worker, like notifications (@shkriuss/push):
 *
 *   GET    /api/sync/hub            where this app's hub (Account page) is
 *   GET    /api/sync/copy?since=N   the account's sealed copy (204 if still N; version 0 if none yet)
 *   PUT    /api/sync/copy           replace it: { base, data } (409 if base is out of date)
 *   DELETE /api/sync/copy           delete it, and its files (leaves a note that it was deleted)
 *   DELETE /api/sync/copy?moved     the same, after it was moved to a new account key
 *                                   (for good: a moved copy can't be started again)
 *
 * Apps with files, like photos, turn these on with syncHandler({ files: true })
 * (docs/adr/0014-syncing-photos.md):
 *
 *   GET    /api/sync/files              the account's files: FileList
 *   PUT    /api/sync/files/<id>         add or replace one: its sealed bytes (507 if there's no room)
 *   GET    /api/sync/files/<id>         one file's sealed bytes (404 if there isn't one)
 *   DELETE /api/sync/files/<id>?base=N  delete one, if the copy is still version N (409 if not)
 *
 * The account is identified by a token derived from the app's own key
 * (a bearer token); the server stores only its SHA-256 hash, and each app's
 * token is different. The copy and the files arrive sealed on the device, so
 * the server can't read them. Files are kept with the copy: deleting it
 * deletes them, and none can be added after that.
 *
 * Anyone can make up a token, so all of an app's copies together have a limit
 * (STORAGE_LIMITS, kept by the namespace's meter: @shkriuss/server/meter),
 * and a copy nobody has used for about 13 months is deleted
 * (docs/adr/0017-storage-limits.md).
 */
import {
  API_HEADERS,
  bearerToken,
  bytesBody,
  createWorker,
  json,
  jsonBody,
  noContent,
  problem,
  sha256Text,
  type ApiHandler,
  type DurableObjectState,
  type DurableObjectStub,
  type DurableObjectNamespace,
  type SiteEnv,
} from '@shkriuss/server';
import {
  GRANTED_KEY,
  LIMIT_HEADER,
  limitFor,
  limitOf,
  METER,
  meterFetch,
  NO_LIMIT,
  release,
  reserve,
} from '@shkriuss/server/meter';
import { hubOriginFor } from './origins.ts';
import {
  checkPut,
  FILE_ID,
  MAX_FILE_BYTES,
  MAX_REQUEST_BYTES,
  roomFor,
  type FileIndex,
  type FileList,
} from './validate.ts';

export interface SyncEnv extends SiteEnv {
  SYNC_COPIES: DurableObjectNamespace;
  /** Only for local browser tests: the hub's address (it can't be worked out on 127.0.0.1). */
  HUB_ORIGIN?: string;
}

export interface SyncOptions {
  /** Sync files too, like photos (docs/adr/0014-syncing-photos.md). */
  files?: boolean;
}

/** Changes per account in 10 minutes: to the copy, and to its files. */
const WRITES_PER_WINDOW = 120;
const FILE_WRITES_PER_WINDOW = 300;
const WINDOW_MS = 10 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A copy nobody has synced with, or even asked about, for this long (about 13
 * months) is deleted, files and all. Devices still using it start a new one
 * from their own data, so only made-up copies go for good.
 */
export const UNUSED_MS = 396 * DAY_MS;

/**
 * All of one app's copies together, in bytes, on the real site and on a PR
 * preview: copies only, or copies with their files (Repairs). Each copy also
 * counts 16 KB, whatever it holds (@shkriuss/server/meter). Every app's limits
 * together fit in the free plan's 5 GB (docs/adr/0017-storage-limits.md).
 */
export const STORAGE_LIMITS = {
  copies: { site: 120_000_000, preview: 20_000_000 },
  files: { site: 1_000_000_000, preview: 80_000_000 },
} as const;

/** 507: the app's limit is reached, so nothing more is kept for now. */
const full = (): Response => problem(507, 'There’s no room left online for this app just now.');

/** Requests to /api/sync/*. */
export async function handleSync(
  request: Request,
  env: SyncEnv,
  path: string,
  options: SyncOptions = {},
): Promise<Response> {
  if (path === '/api/sync/hub') {
    if (request.method !== 'GET') return problem(405, 'Use GET.');
    const origin = hubOriginFor(new URL(request.url), env.HUB_ORIGIN);
    return origin ? json({ origin }) : problem(404, 'No hub for this address.');
  }
  const file = options.files ? /^\/api\/sync\/files(?:\/([^/]*))?$/.exec(path) : null;
  if (path !== '/api/sync/copy' && !file) return problem(404, 'Not found.');

  const token = bearerToken(request);
  if (!token) return problem(401, 'Missing or malformed sync token.');
  const object = env.SYNC_COPIES.get(env.SYNC_COPIES.idFromName(await sha256Text(token)));
  // Each request tells the copy the app's limit on this site.
  const limit = limitFor(
    new URL(request.url),
    options.files ? STORAGE_LIMITS.files : STORAGE_LIMITS.copies,
  );
  const copy: DurableObjectStub = {
    fetch: (input, init = {}) =>
      object.fetch(input, { ...init, headers: { [LIMIT_HEADER]: String(limit) } }),
  };
  if (file) return handleFile(request, copy, file[1]);

  if (request.method === 'GET') {
    const since = new URL(request.url).searchParams.get('since') ?? '';
    return copy.fetch(`https://copy/?since=${encodeURIComponent(since)}`);
  }
  if (request.method === 'DELETE') {
    const moved = new URL(request.url).searchParams.has('moved');
    return copy.fetch(`https://copy/${moved ? '?moved' : ''}`, { method: 'DELETE' });
  }
  if (request.method !== 'PUT') return problem(405, 'Use GET, PUT or DELETE.');
  // Only the size is checked here, and the copy checks the rest: checking a
  // full-size copy here took about 8 ms of the free plan's 10 ms of CPU time
  // (audit finding B-9), while the copy's object has 30 seconds.
  const read = await bytesBody(request, MAX_REQUEST_BYTES);
  if (!read.ok) return read.response;
  return copy.fetch('https://copy/', { method: 'PUT', body: read.body });
}

/** /api/sync/files (id undefined) and /api/sync/files/<id>. */
async function handleFile(
  request: Request,
  copy: DurableObjectStub,
  id: string | undefined,
): Promise<Response> {
  if (id === undefined) {
    if (request.method !== 'GET') return problem(405, 'Use GET.');
    return copy.fetch('https://copy/files');
  }
  if (!FILE_ID.test(id)) return problem(400, 'Not a file id.');
  const url = `https://copy/files/${id}`;
  if (request.method === 'GET') return copy.fetch(url);
  if (request.method === 'DELETE') {
    const base = Number(new URL(request.url).searchParams.get('base'));
    if (!Number.isSafeInteger(base) || base < 1) {
      return problem(400, '"base" must be the version of the copy.');
    }
    return copy.fetch(`${url}?base=${base}`, { method: 'DELETE' });
  }
  if (request.method !== 'PUT') return problem(405, 'Use GET, PUT or DELETE.');
  const read = await bytesBody(request, MAX_FILE_BYTES);
  if (!read.ok) return read.response;
  // Sealed: 12 bytes of IV and 16 of tag around at least one byte.
  if (read.body.length < 29) return problem(400, 'Not a sealed file.');
  return copy.fetch(url, { method: 'PUT', body: read.body });
}

/** A handler for /api/sync, with files or without (the default). */
export const syncHandler =
  (options: SyncOptions = {}): ApiHandler<SyncEnv> =>
  (request, env, path) =>
    handleSync(request, env, path, options);

export default createWorker<SyncEnv>({ '/api/sync': handleSync });

// ---------- One account's copy of one app's data, and its files ----------

type Saved =
  | { version: number; epoch: string; data: string; at: number }
  | { version: number; epoch: string; deleted: true; moved?: true; at: number };

/** Changes counted since `start` (ms). */
interface WriteWindow {
  start: number;
  count: number;
}

const isDeleted = (saved: Saved): saved is Extract<Saved, { deleted: true }> => 'deleted' in saved;
const isMoved = (saved: Saved | undefined): boolean =>
  saved !== undefined && isDeleted(saved) && saved.moved === true;

/** 410 Gone, saying whether the copy was deleted or moved to a new account key. */
const gone = (saved: Saved | undefined): Response =>
  saved && isDeleted(saved) && saved.moved
    ? json({ error: 'The online copy was moved to a new account key.', moved: true }, 410)
    : problem(410, 'The online copy was deleted.');

const fileKey = (id: string) => `file:${id}`;

/**
 * A new copy's first version: the time, in seconds. A copy deleted for being
 * unused leaves nothing behind, so the one started after it must never reuse
 * a version a device saw before: that device would take it for the old one.
 * A copy changes at most once every 5 seconds or so (WRITES_PER_WINDOW), and
 * the new one starts at least 13 months after the old one's last change.
 */
const firstVersion = (now: number): number => Math.floor(now / 1000);

/** What the copy and its files hold, in bytes: what the meter counts. */
function storedBytes(saved: Saved | undefined, files: FileIndex): number {
  const data = saved && !isDeleted(saved) ? saved.data.length : 0;
  return Object.values(files).reduce((sum, [size]) => sum + size, data);
}

export class SyncCopy {
  readonly state: DurableObjectState;
  readonly env: SyncEnv;

  constructor(state: DurableObjectState, env: SyncEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // The app's meter is one of these objects too, named METER.
    if (url.hostname === METER) return meterFetch(this.state, request);
    // One request at a time, so two devices can't both write version N + 1.
    return this.state.blockConcurrencyWhile(async () => {
      const storage = this.state.storage;
      const saved = await storage.get<Saved>('copy');
      const now = Date.now();
      const limit = limitOf(request);
      const file = /^\/files(?:\/(.+))?$/.exec(url.pathname);
      if (file) return this.#file(request, url, saved, file[1], now, limit);

      if (request.method === 'GET') {
        // Nothing synced yet is normal (a first sync), so it isn't an error.
        if (!saved) return json({ version: 0 });
        await this.#touch(now);
        if (isDeleted(saved)) return gone(saved);
        const since = url.searchParams.get('since');
        if (since === String(saved.version)) return noContent();
        return json({ version: saved.version, epoch: saved.epoch, data: saved.data });
      }

      if (request.method === 'DELETE') {
        // Everything goes, files included; only the note that it was deleted stays.
        // Moved is for good: devices still on the old key must keep hearing it.
        const moved = url.searchParams.has('moved') || isMoved(saved);
        const files = await storage.get<FileIndex>('files');
        // Nothing was ever kept for this token: nothing to delete, or to note.
        if (!saved && !files && !moved) return noContent();
        if (files) await this.#deleteAllBut(['writes', GRANTED_KEY]);
        // Deleting what's kept is never refused; only a note for nothing counts as new.
        const kept = saved !== undefined || files !== undefined;
        if (!(await reserve(this.state, this.env.SYNC_COPIES, 0, kept ? NO_LIMIT : limit))) {
          return full();
        }
        await storage.put('copy', {
          version: (saved?.version ?? 0) + 1,
          epoch: saved?.epoch ?? '',
          deleted: true,
          ...(moved ? { moved: true as const } : {}),
          at: now,
        } satisfies Saved);
        await this.#touch(now);
        return noContent();
      }

      // PUT, checked here rather than in the Worker (handleSync), before anything is kept.
      const read = await jsonBody(request, MAX_REQUEST_BYTES);
      if (!read.ok) return read.response;
      const checked = checkPut(read.body);
      if (!checked.ok) return problem(400, checked.error);
      const { base, data } = checked.value;
      const live = saved && !isDeleted(saved) ? saved : undefined;
      if (base === null) {
        // Starting a copy: only when there isn't one. A deleted one can be started
        // again, but not one moved to a new account key: the old key may be a lost
        // device's, and starting it again would let it read the other devices' edits.
        if (isMoved(saved)) return gone(saved);
        if (live) {
          return json({ error: 'There is already a copy.', ...this.#current(live) }, 409);
        }
      } else {
        if (!saved) return problem(404, 'Nothing synced yet.');
        if (!live) return gone(saved);
        if (base !== live.version) {
          return json({ error: 'Someone else changed it first.', ...this.#current(live) }, 409);
        }
      }
      const writes = await this.#window('writes', WRITES_PER_WINDOW, now);
      if (!writes) return problem(429, 'Too many changes; try again soon.');
      const files = (await storage.get<FileIndex>('files')) ?? {};
      const bytes = data.length + storedBytes(undefined, files);
      if (!(await reserve(this.state, this.env.SYNC_COPIES, bytes, limit))) return full();
      const next: Saved = live
        ? { version: live.version + 1, epoch: live.epoch, data, at: now }
        : {
            version: saved ? saved.version + 1 : firstVersion(now),
            epoch: crypto.randomUUID(),
            data,
            at: now,
          };
      await storage.put('writes', writes);
      await storage.put('copy', next);
      await this.#touch(now);
      return json({ version: next.version, epoch: next.epoch });
    });
  }

  /**
   * UNUSED_MS after the copy was last used: everything goes, so copies made up
   * by strangers don't stay for good, and their room is given back.
   */
  async alarm(): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      const active = (await this.state.storage.get<number>('active')) ?? 0;
      if (Date.now() - active < UNUSED_MS) {
        await this.state.storage.setAlarm(active + UNUSED_MS);
        return;
      }
      await release(this.state, this.env.SYNC_COPIES);
      await this.state.storage.deleteAll();
    });
  }

  /** Keeps the copy for UNUSED_MS more. At most once a day: each time is a write. */
  async #touch(now: number): Promise<void> {
    const active = await this.state.storage.get<number>('active');
    if (active !== undefined && now - active < DAY_MS) return;
    await this.state.storage.put('active', now);
    await this.state.storage.setAlarm(now + UNUSED_MS);
  }

  /** Deletes everything except these keys. */
  async #deleteAllBut(keep: readonly string[]): Promise<void> {
    const storage = this.state.storage;
    const kept = await Promise.all(keep.map(async (key) => [key, await storage.get(key)] as const));
    await storage.deleteAll();
    for (const [key, value] of kept) if (value !== undefined) await storage.put(key, value);
  }

  /**
   * This 10 minutes' changes with one more, to save with the change; null if
   * there have been too many.
   */
  async #window(key: string, limit: number, now: number): Promise<WriteWindow | null> {
    const writes = (await this.state.storage.get<WriteWindow>(key)) ?? { start: now, count: 0 };
    const window =
      now - writes.start < WINDOW_MS
        ? { ...writes, count: writes.count + 1 }
        : { start: now, count: 1 };
    return window.count > limit ? null : window;
  }

  /** The account's files (id undefined), or one of them. */
  async #file(
    request: Request,
    url: URL,
    saved: Saved | undefined,
    id: string | undefined,
    now: number,
    limit: number,
  ): Promise<Response> {
    const storage = this.state.storage;
    const files = (await storage.get<FileIndex>('files')) ?? {};
    // Only a copy, or files, that are kept here are kept longer.
    if (saved || Object.keys(files).length > 0) await this.#touch(now);
    if (saved && isDeleted(saved)) return gone(saved);

    if (id === undefined) {
      return json({ version: saved?.version ?? 0, now, files } satisfies FileList);
    }
    if (request.method === 'GET') {
      const bytes = Object.hasOwn(files, id)
        ? await storage.get<Uint8Array<ArrayBuffer>>(fileKey(id))
        : undefined;
      if (!bytes) return problem(404, 'No such file.');
      return new Response(bytes, {
        headers: { 'Content-Type': 'application/octet-stream', ...API_HEADERS },
      });
    }

    if (request.method === 'DELETE') {
      // Only if the copy is still what the device saw: a newer one may use the file again.
      if (!saved || url.searchParams.get('base') !== String(saved.version)) {
        return problem(409, 'The copy changed; sync first.');
      }
      if (!Object.hasOwn(files, id)) return noContent();
      const writes = await this.#window('file-writes', FILE_WRITES_PER_WINDOW, now);
      if (!writes) return problem(429, 'Too many changes; try again soon.');
      const rest = Object.fromEntries(Object.entries(files).filter(([other]) => other !== id));
      await storage.put('file-writes', writes);
      await storage.delete(fileKey(id));
      await storage.put('files', rest);
      // Gives back the room, if it's a lot.
      await reserve(this.state, this.env.SYNC_COPIES, storedBytes(saved, rest), limit);
      return noContent();
    }

    // PUT
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!roomFor(files, id, bytes.length)) return problem(507, 'No room for more files.');
    const writes = await this.#window('file-writes', FILE_WRITES_PER_WINDOW, now);
    if (!writes) return problem(429, 'Too many changes; try again soon.');
    const next = { ...files, [id]: [bytes.length, now] as [number, number] };
    if (!(await reserve(this.state, this.env.SYNC_COPIES, storedBytes(saved, next), limit))) {
      return full();
    }
    await storage.put('file-writes', writes);
    await storage.put(fileKey(id), bytes);
    await storage.put('files', next);
    await this.#touch(now);
    return noContent();
  }

  #current(live: { version: number; epoch: string; data: string }) {
    return { version: live.version, epoch: live.epoch, data: live.data };
  }
}
