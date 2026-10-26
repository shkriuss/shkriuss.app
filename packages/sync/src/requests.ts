/** Requests to the app's sync server (./worker.ts), and how they fail, for ./client.ts. */
import { fetchWithLimit, isTimeout } from './request.ts';

const API = '/api/sync';

export type SyncProblem =
  /** No connection, or the app's server didn't answer. */
  | 'offline'
  /** The server refused, or the online copy couldn't be read. */
  | 'server'
  /** Another device has a newer version of the app: wait for this one to update. */
  | 'update-needed'
  /** This version of the app can't read the data saved here: it's kept as it is, unsynced. */
  | 'unreadable'
  /** Too much data to sync. */
  | 'too-big'
  /** The online copy was deleted on another device; sync is now off here. */
  | 'deleted'
  /** The account key was replaced on another device, which moved the copy; sync is now off here. */
  | 'moved'
  /** This browser won't save (blocked, or a private mode). */
  | 'storage'
  /** This browser has no room left for this site's data: sync can't save what it brings. */
  | 'full'
  /** There's no room online for more files: new ones stay on this device. */
  | 'files-full'
  /** Coming back from the hub didn't work (took too long, or another tab). */
  | 'connect-failed';

export class SyncError extends Error {
  readonly problem: SyncProblem;
  constructor(problem: SyncProblem) {
    super(problem);
    this.problem = problem;
  }
}

/** The server's clock when it last answered (ms, from its Date header), or null. */
let answeredAt: number | null = null;

/** The sync server's clock at its latest answer on this page (see SyncClient.trustedNow). */
export const serverClock = (): number | null => answeredAt;

export async function api(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  else if (init.body) headers.set('Content-Type', 'application/octet-stream');
  let response: Response;
  try {
    // No answer in time (a network that hangs) counts as no connection too.
    response = await fetchWithLimit(`${API}${path}`, {
      ...init,
      headers,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    throw new SyncError('offline');
  }
  const date = Date.parse(response.headers.get('Date') ?? '');
  if (Number.isFinite(date)) answeredAt = date;
  return response;
}

/** Why a round failed. An answer that stopped coming in time is no connection. */
export const problemOf = (error: unknown): SyncProblem =>
  error instanceof SyncError ? error.problem : isTimeout(error) ? 'offline' : 'server';

/**
 * The copy was deleted, or moved to a new account key. A deleted one says how
 * long ago (ms; null from a server that doesn't say), for a device that turned
 * sync on after that (audit 4 E-1).
 */
export class GoneError extends SyncError {
  readonly deletedAgo: number | null;
  constructor(problem: 'deleted' | 'moved', deletedAgo: number | null) {
    super(problem);
    this.deletedAgo = deletedAgo;
  }
}

/** A 410 from the server: the copy was deleted, or moved to a new account key. */
export async function goneError(response: Response): Promise<GoneError> {
  const body = (await response.json().catch(() => null)) as {
    moved?: unknown;
    deletedAgo?: unknown;
  } | null;
  if (body?.moved === true) return new GoneError('moved', null);
  const ago = body?.deletedAgo;
  return new GoneError(
    'deleted',
    typeof ago === 'number' && Number.isFinite(ago) && ago >= 0 ? ago : null,
  );
}

export const isGone = (error: unknown): boolean =>
  error instanceof SyncError && (error.problem === 'deleted' || error.problem === 'moved');

/** Any other failed response, as a SyncError (507: the app's room online is used up, ADR 0017). */
export const failed = (response: Response): SyncError =>
  new SyncError(response.status >= 500 && response.status !== 507 ? 'offline' : 'server');

/** An account's keys for one app (./snapshot.ts). */
export interface Keys {
  token: string;
  key: Uint8Array<ArrayBuffer>;
}

/** Thrown when the server says "too many changes": files wait a while. */
export class PausedError extends Error {}
