/**
 * Server side of syncing an app (docs/adr/0010). Runs in the app's own
 * Worker, like notifications (@shkriuss/push):
 *
 *   GET    /api/sync/hub            where this app's hub (Account page) is
 *   GET    /api/sync/copy?since=N   the account's sealed copy (204 if still N; version 0 if none yet)
 *   PUT    /api/sync/copy           replace it: { base, data } (409 if base is out of date)
 *   DELETE /api/sync/copy           delete it (leaves a note that it was deleted)
 *   DELETE /api/sync/copy?moved     the same, after it was moved to a new account key
 *
 * The account is identified by a token derived from the app's own key
 * (a bearer token); the server stores only its SHA-256 hash, and each app's
 * token is different. The copy arrives sealed on the device, so the server
 * can't read it.
 */
import {
  bearerToken,
  createWorker,
  json,
  jsonBody,
  noContent,
  problem,
  sha256Text,
  type DurableObjectNamespace,
  type DurableObjectState,
  type SiteEnv,
} from '@shkriuss/server';
import { hubOriginFor } from './origins.ts';
import { checkPut, MAX_REQUEST_BYTES, type PutRequest } from './validate.ts';

export interface SyncEnv extends SiteEnv {
  SYNC_COPIES: DurableObjectNamespace;
  /** Only for local browser tests: the hub's address (it can't be worked out on 127.0.0.1). */
  HUB_ORIGIN?: string;
}

/** Changes per account in 10 minutes. */
const WRITES_PER_WINDOW = 120;
const WINDOW_MS = 10 * 60 * 1000;

/** Requests to /api/sync/*. */
export async function handleSync(request: Request, env: SyncEnv, path: string): Promise<Response> {
  if (path === '/api/sync/hub') {
    if (request.method !== 'GET') return problem(405, 'Use GET.');
    const origin = hubOriginFor(new URL(request.url), env.HUB_ORIGIN);
    return origin ? json({ origin }) : problem(404, 'No hub for this address.');
  }
  if (path !== '/api/sync/copy') return problem(404, 'Not found.');

  const token = bearerToken(request);
  if (!token) return problem(401, 'Missing or malformed sync token.');
  const copy = env.SYNC_COPIES.get(env.SYNC_COPIES.idFromName(await sha256Text(token)));

  if (request.method === 'GET') {
    const since = new URL(request.url).searchParams.get('since') ?? '';
    return copy.fetch(`https://copy/?since=${encodeURIComponent(since)}`);
  }
  if (request.method === 'DELETE') {
    const moved = new URL(request.url).searchParams.has('moved');
    return copy.fetch(`https://copy/${moved ? '?moved' : ''}`, { method: 'DELETE' });
  }
  if (request.method !== 'PUT') return problem(405, 'Use GET, PUT or DELETE.');
  const read = await jsonBody(request, MAX_REQUEST_BYTES);
  if (!read.ok) return read.response;
  const checked = checkPut(read.body);
  if (!checked.ok) return problem(400, checked.error);
  return copy.fetch('https://copy/', { method: 'PUT', body: JSON.stringify(checked.value) });
}

export default createWorker<SyncEnv>({ '/api/sync': handleSync });

// ---------- One account's copy of one app's data ----------

type Saved =
  | { version: number; epoch: string; data: string; at: number }
  | { version: number; epoch: string; deleted: true; moved?: true; at: number };

const isDeleted = (saved: Saved): saved is Extract<Saved, { deleted: true }> => 'deleted' in saved;

/** 410 Gone, saying whether the copy was deleted or moved to a new account key. */
const gone = (saved: Saved | undefined): Response =>
  saved && isDeleted(saved) && saved.moved
    ? json({ error: 'The online copy was moved to a new account key.', moved: true }, 410)
    : problem(410, 'The online copy was deleted.');

export class SyncCopy {
  readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    // One request at a time, so two devices can't both write version N + 1.
    return this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get<Saved>('copy');
      const now = Date.now();

      if (request.method === 'GET') {
        // Nothing synced yet is normal (a first sync), so it isn't an error.
        if (!saved) return json({ version: 0 });
        if (isDeleted(saved)) return gone(saved);
        const since = new URL(request.url).searchParams.get('since');
        if (since === String(saved.version)) return noContent();
        return json({ version: saved.version, epoch: saved.epoch, data: saved.data });
      }

      if (request.method === 'DELETE') {
        const moved = new URL(request.url).searchParams.has('moved');
        await this.state.storage.put('copy', {
          version: (saved?.version ?? 0) + 1,
          epoch: saved?.epoch ?? '',
          deleted: true,
          ...(moved ? { moved: true as const } : {}),
          at: now,
        } satisfies Saved);
        return noContent();
      }

      // PUT
      const writes = (await this.state.storage.get<{ start: number; count: number }>('writes')) ?? {
        start: now,
        count: 0,
      };
      const window =
        now - writes.start < WINDOW_MS
          ? { ...writes, count: writes.count + 1 }
          : { start: now, count: 1 };
      if (window.count > WRITES_PER_WINDOW)
        return problem(429, 'Too many changes; try again soon.');
      await this.state.storage.put('writes', window);

      const { base, data } = (await request.json()) as PutRequest;
      const live = saved && !isDeleted(saved) ? saved : undefined;
      if (base === null) {
        // Starting a copy: only when there isn't one (a deleted one can be started again).
        if (live) {
          return json({ error: 'There is already a copy.', ...this.#current(live) }, 409);
        }
        const next: Saved = {
          version: (saved?.version ?? 0) + 1,
          epoch: crypto.randomUUID(),
          data,
          at: now,
        };
        await this.state.storage.put('copy', next);
        return json({ version: next.version, epoch: next.epoch });
      }
      if (!saved) return problem(404, 'Nothing synced yet.');
      if (!live) return gone(saved);
      if (base !== live.version) {
        return json({ error: 'Someone else changed it first.', ...this.#current(live) }, 409);
      }
      const next: Saved = { version: live.version + 1, epoch: live.epoch, data, at: now };
      await this.state.storage.put('copy', next);
      return json({ version: next.version, epoch: next.epoch });
    });
  }

  #current(live: { version: number; epoch: string; data: string }) {
    return { version: live.version, epoch: live.epoch, data: live.data };
  }
}
