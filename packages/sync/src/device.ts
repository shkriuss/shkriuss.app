/**
 * This device's sync state, for ./client.ts: the app's key from the account,
 * what the device knew at the last sync (and the server's clock then), and
 * the files still to bring up to date online. Kept under "shkriuss-device:",
 * which backups skip.
 */
import { toBase64Url } from '@shkriuss/crypto';
import { isStorageFull } from '@shkriuss/storage';
import type { Connection } from './connect.ts';
import type { Known } from './merge.ts';

export const STATE_KEY = 'shkriuss-device:sync';
const FILES_KEY = 'shkriuss-device:sync-files';

// ---------- This device's sync state ----------

export interface DeviceState {
  /** The app's own key (from the account), base64url. Null while sync is off. */
  secret: string | null;
  code: string | null;
  /**
   * The online copy's version and lineage when last seen, the most times
   * devices had written it (sealed in the copy; missing before that was
   * added), and whether it had stores this version of the app doesn't sync
   * (a newer version's: they're kept in it as they are, audit 6 S4).
   */
  remote: { version: number; epoch: string; written?: number; others?: true } | null;
  /** What this device knew at the last sync, per store key. */
  known: Record<string, Known>;
  /** True when `known` holds a merge that isn't online yet (the upload failed). */
  dirty: boolean;
  /**
   * The online copy as this device last saw it (its epoch, and per store key
   * what it held). `known` runs ahead of it after a failed upload, or edits
   * while sync was off; keeping both versions needs to know what was online.
   */
  base: { epoch: string; stores: Record<string, Known> } | null;
  last: number | null;
  /**
   * The sync server's clock at the last sync (ms), for deleting data by age
   * without trusting this device's clock (SyncClient.trustedNow). Null until
   * then, and in state saved before it was kept.
   */
  serverTime: number | null;
  /**
   * When sync was last turned on here (ms; the sync server's clock, so a
   * wrong clock here can't change what it means). An online copy deleted
   * before that is started again, and one started again after a deletion
   * before that is joined; otherwise sync turns off (audit 4 E-1). Null in
   * state saved before it was kept.
   */
  connected: number | null;
  /** The app's keys from replaced account keys: their online copies are moved here, then deleted. */
  previous: string[];
  /**
   * Of those, the ones whose copy needs a newer version of this app (or
   * doesn't pass its checks), with this app's data versions when that was
   * found: they're tried again once the app is updated.
   */
  waiting: Record<string, string>;
  /**
   * Keys from replaced account keys this device is done with: their copy
   * was moved (here, or by another device) or deleted. The hub hands an app
   * its replaced keys at every "Turn on sync" for 13 months, but these are
   * never fetched or merged again: once the server's note that the old copy
   * moved is cleaned up, a lost device could start a copy with the old key,
   * and it would have been brought into the person's data (audit 5 A-1).
   * Kept when sync is turned off; at most MAX_RETIRED, oldest first.
   */
  retired: string[];
}

/** Retired keys remembered (the hub sends at most 5 replaced keys at a time). */
const MAX_RETIRED = 20;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const stringRecord = (value: unknown): Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};

export function loadState(): DeviceState | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return null;
    const state = value as Partial<Record<keyof DeviceState, unknown>>;
    const on = typeof state.secret === 'string' && typeof state.code === 'string';
    if (!on && state.secret !== null) return null;
    const base = state.base as Partial<NonNullable<DeviceState['base']>> | null | undefined;
    return {
      secret: on ? (state.secret as string) : null,
      code: on ? (state.code as string) : null,
      remote: (state.remote as DeviceState['remote'] | undefined) ?? null,
      known: (state.known as DeviceState['known'] | undefined) ?? {},
      dirty: state.dirty === true,
      base:
        typeof base?.epoch === 'string' && typeof base.stores === 'object' && base.stores !== null
          ? (base as DeviceState['base'])
          : null,
      last: typeof state.last === 'number' ? state.last : null,
      serverTime: typeof state.serverTime === 'number' ? state.serverTime : null,
      connected: typeof state.connected === 'number' ? state.connected : null,
      previous: strings(state.previous),
      waiting: stringRecord(state.waiting),
      retired: strings(state.retired),
    };
  } catch {
    return null;
  }
}

/** `retired` with `keys` added (once each), the oldest dropped past MAX_RETIRED. */
export const withRetired = (retired: readonly string[], keys: readonly string[]): string[] =>
  [...new Set([...retired, ...keys])].slice(-MAX_RETIRED);

/** Whether the latest saveState() that didn't work found the browser's storage full. */
let stateFull = false;

export function saveState(state: DeviceState | null): boolean {
  try {
    if (state) localStorage.setItem(STATE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STATE_KEY);
    return true;
  } catch (error) {
    stateFull = isStorageFull(error);
    return false;
  }
}

/** Why the latest saveState() didn't work: no room, or no storage at all. */
export const stateProblem = (): 'full' | 'storage' => (stateFull ? 'full' : 'storage');

/** Files to bring up to date online (apps with files only), kept apart so a sync can't overwrite them. */
export interface FileState {
  /** Saved here; not online yet. */
  uploads: string[];
  /** Deleted here; maybe still online. */
  removals: string[];
  /** When every file was last checked against the online list (null: not since sync was turned on). */
  checked: number | null;
  /** The server said "too many changes": files wait until then (ms). */
  paused: number | null;
}

export function loadFiles(): FileState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FILES_KEY) ?? 'null');
    const files = (typeof value === 'object' && value !== null ? value : {}) as Partial<
      Record<keyof FileState, unknown>
    >;
    const time = (time: unknown) => (typeof time === 'number' ? time : null);
    return {
      uploads: strings(files.uploads),
      removals: strings(files.removals),
      checked: time(files.checked),
      paused: time(files.paused),
    };
  } catch {
    return { uploads: [], removals: [], checked: null, paused: null };
  }
}

/** Changes the file lists in one go (nothing else runs in between). */
export function updateFiles(change: (files: FileState) => FileState): boolean {
  try {
    localStorage.setItem(FILES_KEY, JSON.stringify(change(loadFiles())));
    return true;
  } catch {
    return false;
  }
}

/** Sync was turned off, or on with another key: start again with a full check. */
export function forgetFiles(): void {
  try {
    localStorage.removeItem(FILES_KEY);
  } catch {
    // Nothing saved, so nothing to forget.
  }
}

/** Whether this device syncs this app. */
export const isSyncOn = (): boolean => typeof loadState()?.secret === 'string';

/**
 * Stops syncing on this device and forgets what it knew, so a later "Turn on
 * sync" starts like the first time (what's online wins). For when all data is
 * deleted here, or replaced from a backup. Never throws.
 */
export function stopSync(): void {
  saveState(null);
  forgetFiles();
}

/** Sync off, keeping what this device knew. */
export const offState = (state: DeviceState): DeviceState => ({
  ...state,
  secret: null,
  code: null,
  remote: null,
  connected: null,
  previous: [],
  waiting: {},
});

/**
 * Saves the connection the hub sent (coming back from "Turn on sync", which
 * the person pressed at `turnedOn`: see DeviceState.connected). Connecting
 * again with the same key keeps what this device knew; with another key,
 * this device's data is merged into that account's copy at the next sync.
 * Keys the new one replaced are remembered until their copies are moved;
 * keys this device is done with (`retired`) never again. Returns false if
 * the browser won't save.
 */
export function saveConnection(connection: Connection, turnedOn = Date.now()): boolean {
  const existing = loadState();
  const secret = toBase64Url(connection.secret);
  const retired = existing?.retired ?? [];
  const replaces = connection.replaces
    .map(toBase64Url)
    .filter((key) => key !== secret && !retired.includes(key));
  if (existing?.secret === secret) {
    const previous = [...new Set([...existing.previous, ...replaces])];
    return saveState({ ...existing, code: connection.code, connected: turnedOn, previous });
  }
  // Another key: only the keys it replaced move into it. Old keys the last
  // one was still moving belong to that key's account, which may not be
  // this one: its copies must not move into someone else's (audit 4 A-1).
  // (If it is this account, but the hub no longer knows those keys, their
  // copies stay where they are, as when sync turns off: nothing in them is
  // lost, and a copy nobody uses is deleted after 13 months.)
  const previous = [...new Set(replaces)];
  const waiting = Object.fromEntries(
    Object.entries(existing?.waiting ?? {}).filter(([key]) => previous.includes(key)),
  );
  forgetFiles();
  return saveState({
    secret,
    code: connection.code,
    remote: null,
    known: existing?.known ?? {},
    dirty: existing?.dirty ?? false,
    base: existing?.base ?? null,
    last: null,
    serverTime: existing?.serverTime ?? null,
    connected: turnedOn,
    previous,
    waiting,
    retired,
  });
}

/** Sync was turned off, or on with another key, while a round waited for the server. */
export class StoppedError extends Error {}

/**
 * A round reads this device's state at the start, then waits for the server.
 * Meanwhile the person may turn sync off, or delete all data (which turns it
 * off first): then the round stops without saving anything, so that stays
 * done. Call this before every save after waiting.
 */
export function checkStillOn(secret: string): void {
  if (loadState()?.secret !== secret) throw new StoppedError();
}

/** Saves what a round learned onto the state as it is now (see checkStillOn). False if the browser won't save. */
export function updateState(secret: string, change: Partial<DeviceState>): boolean {
  const current = loadState();
  if (current?.secret !== secret) throw new StoppedError();
  return saveState({ ...current, ...change });
}
