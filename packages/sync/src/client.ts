/**
 * Syncing an app's data between devices, browser side (docs/adr/0010).
 *
 *   const sync = createSync({ app: 'tally', stores: [...], onChange: rerender });
 *   sync.changed();   // after every save: syncs a moment later
 *   sync.connect();   // "Turn on sync": goes to the hub's Account page and back
 *
 * Opening the app with "#sync=connect" (from the hub's list of apps) starts
 * "Turn on sync" straight away; "#sync=off&proof=…" turns it off, if the
 * proof is from the account this app syncs with (./connect.ts).
 *
 * Each round: read this device's items, fetch the online copy if it changed,
 * merge (./merge.ts: newest edit of each item wins, deletions sync), save the
 * result here, and upload it if it differs. The copy is sealed on the device
 * (./snapshot.ts). Conflicting uploads from two devices are caught by the
 * server (version numbers) and simply merged again.
 *
 * This device's sync key and what it knew at the last sync are kept under
 * "shkriuss-device:", which backups skip. What it knew stays when sync is
 * turned off, so turning it on again later still syncs what was edited or
 * deleted here in between.
 *
 * After the account key is replaced (a lost device), connecting again gives
 * the app its new key plus the old one. The next round brings the old online
 * copy along into the new one, then deletes the old copy, so devices still
 * using it turn sync off and say why.
 *
 * Apps with files, like photos, pass `files` too (docs/adr/0014): after each
 * sync, files saved here go online and files deleted here are deleted online,
 * each sealed on its own. Other devices download a file when they first need
 * it (download()).
 */
import { fromBase64Url, openBytes, sealBytes, toBase64Url } from '@shkriuss/crypto';
import type { Store } from '@shkriuss/storage';
import {
  CONNECT_LIFETIME_MS,
  connectUrl,
  type Connection,
  newConnectRequest,
  openConnection,
  parseConnectResult,
  parseTurnOff,
  type PendingConnect,
  turnOffProof,
} from './connect.ts';
import {
  byId,
  canonical,
  keepBoth,
  knownFrom,
  merge,
  observe,
  prune,
  upgradeKnown,
  valuesOf,
  type Identified,
  type Known,
  type StoreSnapshot,
} from './merge.ts';
import { fileLabel, openStores, sealStores, syncKeys, type Stores } from './snapshot.ts';

export { secondVersionName } from './merge.ts';
import { FILE_ID, MAX_FILE_BYTES, MAX_SEALED_CHARS, type FileList } from './validate.ts';

const STATE_KEY = 'shkriuss-device:sync';
const FILES_KEY = 'shkriuss-device:sync-files';
const PENDING_KEY = 'shkriuss-device:connect';
const API = '/api/sync';
/** After a change, wait this long so quick edits go up together. */
const CHANGE_DELAY_MS = 1500;
/** While the app is open and visible, look for changes from other devices this often. */
const POLL_MS = 60 * 1000;
/** Merge again at most this many times in a row when another device writes first. */
const MAX_ROUNDS = 3;
/** Check every file against the online list this often (and once sync is turned on). */
const CHECK_FILES_MS = 24 * 60 * 60 * 1000;
/**
 * The daily check leaves files this new alone: they go online before the
 * data that uses them, so another device may not have sent that data yet.
 */
const NEW_FILE_MS = 24 * 60 * 60 * 1000;
/** After the server says "too many changes", leave files alone this long. */
const FILES_PAUSE_MS = 10 * 60 * 1000;

/** A store whose data is a list of items with ids, and how to get the list in and out. */
export interface SyncedStore<T = unknown, I extends Identified = Identified> {
  store: Store<T>;
  items(value: T): readonly I[];
  withItems(value: T, items: I[]): T;
  /**
   * Optional: when an item was changed on this device and on another before
   * they synced, keep both instead of only the newest. Return this device's
   * version as a new item, with a new id (the other device's version keeps
   * the item). Edits then also win over deletions on another device.
   */
  conflictCopy?(mine: I, theirs: I): I;
}

/**
 * Files that go with an app's data, like photos: too big for the copy, so
 * each one is sealed and kept online on its own (docs/adr/0014).
 */
export interface SyncedFiles {
  /** The ids of every file the app's data uses now, whether it's on this device or not. */
  wanted(): ReadonlySet<string>;
  /** This device's copy of a file, or null if it hasn't got it. */
  read(id: string): Promise<Uint8Array<ArrayBuffer> | null>;
}

/**
 * Data an app keeps online beside its copy, in a way of its own (like Photos'
 * library, docs/adr/0016): deleted with the copy, and moved with it to a new
 * account key. Each gets the app's own keys from the account, to derive what
 * it needs.
 */
export interface LinkedData {
  /** Before "Delete the online copy" deletes the copy. If it throws, nothing is deleted. */
  delete(secret: Uint8Array<ArrayBuffer>): Promise<void>;
  /**
   * After the account key was replaced: the old copy is in the new one, and
   * is deleted next. If it throws, the next sync tries again.
   */
  move(from: Uint8Array<ArrayBuffer>, to: Uint8Array<ArrayBuffer>): Promise<void>;
}

/**
 * Describes one store to sync, e.g.
 *   syncedStore({ store, items: (state) => state.events, withItems: (state, events) => ({ ...state, events }) })
 * Values from other devices are checked with the store's own validation before they're saved.
 */
export const syncedStore = <T, I extends Identified>(config: SyncedStore<T, I>): SyncedStore =>
  config as unknown as SyncedStore;

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
  /** This browser won't save. */
  | 'storage'
  /** There's no room online for more files: new ones stay on this device. */
  | 'files-full'
  /** Coming back from the hub didn't work (took too long, or another tab). */
  | 'connect-failed';

export interface SyncStatus {
  on: boolean;
  /** The account code, when on. */
  code: string | null;
  /** When the last sync finished (ms), if any. */
  last: number | null;
  busy: boolean;
  problem: SyncProblem | null;
}

/** Things that just happened, for a message. */
export type SyncEvent =
  | 'connected'
  | 'cancelled'
  | 'synced'
  /** Synced, and something changed on two devices at once was kept in both versions. */
  | 'kept-both'
  | 'turned-off'
  /** A link to turn sync off came from a different account, so sync stayed on. */
  | 'kept-on'
  | 'deleted-online';

export interface SyncClient {
  status(): SyncStatus;
  subscribe(listener: (status: SyncStatus, event?: SyncEvent) => void): () => void;
  /** Call after every save. */
  changed(): void;
  syncNow(): Promise<void>;
  /** Goes to the hub to connect this app (the page navigates away). */
  connect(): Promise<void>;
  /** Stops syncing on this device; the online copy stays for other devices. */
  turnOff(): void;
  /** Deletes the online copy (and its files) and stops syncing on this device. Data here stays. */
  deleteOnline(): Promise<void>;
  /** After saving files here that the data uses: they go online at the next sync. */
  filesAdded(ids: readonly string[]): void;
  /** After deleting files here that the data no longer uses: they're deleted online too. */
  filesRemoved(ids: readonly string[]): void;
  /** A file from another device, or null if it isn't online (or sync is off, or there's no connection). */
  download(id: string): Promise<Uint8Array<ArrayBuffer> | null>;
  /** The app's own key from the account while sync is on (for LinkedData); null when it's off. */
  secret(): Uint8Array<ArrayBuffer> | null;
}

// ---------- This device's sync state ----------

interface DeviceState {
  /** The app's own key (from the account), base64url. Null while sync is off. */
  secret: string | null;
  code: string | null;
  /** The online copy's version and lineage when last seen. */
  remote: { version: number; epoch: string } | null;
  /** What this device knew at the last sync, per store key. */
  known: Record<string, Known>;
  /** True when `known` holds a merge that isn't online yet (the upload failed). */
  dirty: boolean;
  last: number | null;
  /** The app's keys from replaced account keys: their online copies are moved here, then deleted. */
  previous: string[];
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function loadState(): DeviceState | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return null;
    const state = value as Partial<Record<keyof DeviceState, unknown>>;
    const on = typeof state.secret === 'string' && typeof state.code === 'string';
    if (!on && state.secret !== null) return null;
    return {
      secret: on ? (state.secret as string) : null,
      code: on ? (state.code as string) : null,
      remote: (state.remote as DeviceState['remote'] | undefined) ?? null,
      known: (state.known as DeviceState['known'] | undefined) ?? {},
      dirty: state.dirty === true,
      last: typeof state.last === 'number' ? state.last : null,
      previous: strings(state.previous),
    };
  } catch {
    return null;
  }
}

function saveState(state: DeviceState | null): boolean {
  try {
    if (state) localStorage.setItem(STATE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STATE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Files to bring up to date online (apps with files only), kept apart so a sync can't overwrite them. */
interface FileState {
  /** Saved here; not online yet. */
  uploads: string[];
  /** Deleted here; maybe still online. */
  removals: string[];
  /** When every file was last checked against the online list (null: not since sync was turned on). */
  checked: number | null;
  /** The server said "too many changes": files wait until then (ms). */
  paused: number | null;
}

function loadFiles(): FileState {
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
function updateFiles(change: (files: FileState) => FileState): boolean {
  try {
    localStorage.setItem(FILES_KEY, JSON.stringify(change(loadFiles())));
    return true;
  } catch {
    return false;
  }
}

/** Sync was turned off, or on with another key: start again with a full check. */
function forgetFiles(): void {
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
const offState = (state: DeviceState): DeviceState => ({
  ...state,
  secret: null,
  code: null,
  remote: null,
  previous: [],
});

/**
 * Saves the connection the hub sent (coming back from "Turn on sync").
 * Connecting again with the same key changes nothing; with another key, this
 * device's data is merged into that account's copy at the next sync. Keys
 * the new one replaced are remembered until their copies are moved. Returns
 * false if the browser won't save.
 */
export function saveConnection(connection: Connection): boolean {
  const existing = loadState();
  const secret = toBase64Url(connection.secret);
  const previous = [
    ...new Set([...(existing?.previous ?? []), ...connection.replaces.map(toBase64Url)]),
  ].filter((key) => key !== secret);
  if (existing?.secret === secret) {
    return saveState({ ...existing, code: connection.code, previous });
  }
  forgetFiles();
  return saveState({
    secret,
    code: connection.code,
    remote: null,
    known: existing?.known ?? {},
    dirty: existing?.dirty ?? false,
    last: null,
    previous,
  });
}

class SyncError extends Error {
  readonly problem: SyncProblem;
  constructor(problem: SyncProblem) {
    super(problem);
    this.problem = problem;
  }
}

/** Sync was turned off, or on with another key, while a round waited for the server. */
class StoppedError extends Error {}

/**
 * A round reads this device's state at the start, then waits for the server.
 * Meanwhile the person may turn sync off, or delete all data (which turns it
 * off first): then the round stops without saving anything, so that stays
 * done. Call this before every save after waiting.
 */
function checkStillOn(secret: string): void {
  if (loadState()?.secret !== secret) throw new StoppedError();
}

/** Saves what a round learned onto the state as it is now (see checkStillOn). False if the browser won't save. */
function updateState(secret: string, change: Partial<DeviceState>): boolean {
  const current = loadState();
  if (current?.secret !== secret) throw new StoppedError();
  return saveState({ ...current, ...change });
}

async function api(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  else if (init.body) headers.set('Content-Type', 'application/octet-stream');
  try {
    return await fetch(`${API}${path}`, {
      ...init,
      headers,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    throw new SyncError('offline');
  }
}

/**
 * Why a store's data here can't be synced, if it can't: it's from a newer
 * version of the app (or this device last synced with a newer version), or
 * this version can't read it. The store then loads as empty, which would
 * look as if everything had been deleted here.
 */
function unsyncable(synced: SyncedStore, known: Known | undefined): SyncProblem | null {
  const status = synced.store.status();
  if (status === 'newer' || (known?.v ?? 0) > synced.store.version) return 'update-needed';
  return status === 'unreadable' ? 'unreadable' : null;
}

/** The items of data saved in an older data version, by id; null if they can't be read. */
function oldItems(synced: SyncedStore, data: unknown): Map<string, unknown> | null {
  try {
    const items: unknown = synced.items(data);
    if (!Array.isArray(items)) return null;
    return new Map(items.map((item: Partial<Identified> | null) => [item?.id ?? '', item]));
  } catch {
    return null;
  }
}

/**
 * What this device knew, brought to each store's current data version after
 * an update that changed it (merge.ts upgradeKnown). It compares with the
 * data as still saved in the old version, if the app hasn't saved since.
 */
function knownNow(stores: readonly SyncedStore[], known: Record<string, Known>) {
  let result = known;
  for (const synced of stores) {
    const { key, version } = synced.store;
    const before = known[key];
    if (before?.v === undefined || before.v >= version || unsyncable(synced, before)) continue;
    const saved = synced.store.raw();
    const old = saved?.v === before.v ? oldItems(synced, saved.data) : null;
    const current = synced.items(synced.store.load());
    result = { ...result, [key]: upgradeKnown(before, current, old, version) };
  }
  return result;
}

/** A 410 from the server: the copy was deleted, or moved to a new account key. */
async function goneError(response: Response): Promise<SyncError> {
  const body = (await response.json().catch(() => null)) as { moved?: unknown } | null;
  return new SyncError(body?.moved === true ? 'moved' : 'deleted');
}

const isGone = (error: unknown): boolean =>
  error instanceof SyncError && (error.problem === 'deleted' || error.problem === 'moved');

/** Any other failed response, as a SyncError. */
const failed = (response: Response): SyncError =>
  new SyncError(response.status >= 500 ? 'offline' : 'server');

/** An account's keys for one app (./snapshot.ts). */
interface Keys {
  token: string;
  key: Uint8Array<ArrayBuffer>;
}

/** Thrown when the server says "too many changes": files wait a while. */
class PausedError extends Error {}

/** The online copy, or why there isn't one. */
type Remote =
  | { kind: 'same' }
  | { kind: 'none' }
  | { kind: 'copy'; version: number; epoch: string; stores: Stores };

// ---------- The client ----------

export function createSync(options: {
  app: string;
  /** Made with syncedStore(). */
  stores: readonly SyncedStore[];
  /** Called after changes from other devices were saved here: show them. */
  onChange: () => void;
  /** Files that go with the data, like photos. The app's Worker must allow them. */
  files?: SyncedFiles;
  /** Data the app keeps online beside the copy, deleted and moved with it. */
  linked?: LinkedData;
}): SyncClient {
  const { stores, files, linked } = options;
  const listeners = new Set<(status: SyncStatus, event?: SyncEvent) => void>();
  let busy = false;
  /** Items kept in both versions during this run (see SyncedStore.conflictCopy). */
  let keptBoth = 0;
  let again = false;
  let problem: SyncProblem | null = null;
  /** Set when a file had no room online during this run. */
  let noRoom = false;
  let timer: number | undefined;

  const status = (): SyncStatus => {
    const state = loadState();
    return {
      on: typeof state?.secret === 'string',
      code: state?.code ?? null,
      last: state?.last ?? null,
      busy,
      problem,
    };
  };
  const emit = (event?: SyncEvent) => {
    const current = status();
    for (const listener of listeners) listener(current, event);
  };

  async function fetchRemote(
    since: number | null,
    token: string,
    key: Uint8Array<ArrayBuffer>,
  ): Promise<Remote> {
    const response = await api(`/copy${since === null ? '' : `?since=${since}`}`, {}, token);
    if (response.status === 204) return { kind: 'same' } as Remote;
    if (response.status === 410) throw await goneError(response);
    if (!response.ok) throw new SyncError(response.status >= 500 ? 'offline' : 'server');
    const copy = (await response.json()) as { version: number; epoch?: string; data?: string };
    if (copy.data === undefined || copy.epoch === undefined) return { kind: 'none' } as Remote;
    let opened: Stores;
    try {
      opened = await openStores(key, options.app, copy.data);
    } catch (error) {
      throw new SyncError(error instanceof RangeError ? 'update-needed' : 'server');
    }
    return { kind: 'copy', version: copy.version, epoch: copy.epoch, stores: opened } as Remote;
  }

  /** The other device's items for one store, in this app's current data version. */
  function upgrade(synced: SyncedStore, remote: StoreSnapshot): StoreSnapshot {
    if (remote.v > synced.store.version) throw new SyncError('update-needed');
    if (remote.v === synced.store.version) return remote;
    const values = valuesOf(remote) as Identified[];
    const upgraded = synced.store.read(remote.v, synced.withItems(synced.store.empty(), values));
    if (upgraded === undefined) throw new SyncError('server');
    const items = byId(remote.items);
    for (const item of synced.items(upgraded)) {
      const entry = items[item.id];
      if (entry && !('deleted' in entry)) items[item.id] = { t: entry.t, value: item };
    }
    return { ...remote, v: synced.store.version, items };
  }

  /** The online copies of replaced keys still to move here (gone ones have nothing to bring). */
  async function fetchPrevious(previous: readonly string[]) {
    const copies: (Keys & { secret: Uint8Array<ArrayBuffer>; stores: Stores })[] = [];
    for (const encoded of previous) {
      const secret = fromBase64Url(encoded);
      const { token, key } = await syncKeys(secret);
      try {
        const remote = await fetchRemote(null, token, key);
        if (remote.kind === 'copy') copies.push({ secret, token, key, stores: remote.stores });
      } catch (error) {
        if (!isGone(error)) throw error;
      }
    }
    return copies;
  }

  /** What this device sees now, for each store, given what it knew. */
  function observeAll(state: DeviceState, now: number) {
    const before: Record<string, string> = {};
    const local: Stores = {};
    let changed = false;
    for (const synced of stores) {
      const problem = unsyncable(synced, state.known[synced.store.key]);
      if (problem) throw new SyncError(problem);
      const value = synced.store.load();
      before[synced.store.key] = canonical(value);
      const seen = observe(
        state.known[synced.store.key],
        synced.items(value),
        synced.store.version,
        now,
      );
      local[synced.store.key] = seen.snapshot;
      changed ||= seen.changed;
    }
    return { before, local, changed };
  }

  /** One round. Returns false if it should run again (another device wrote first, or a local edit). */
  async function round(): Promise<boolean> {
    const stored = loadState();
    if (!stored?.secret) return true;
    const { secret } = stored;
    const state = { ...stored, known: knownNow(stores, stored.known) };
    const { token, key } = await syncKeys(fromBase64Url(secret));
    const now = Date.now();

    // 1. This device.
    const { before, local, changed: localChanged } = observeAll(state, now);

    // 2. The online copy, and any old copies to bring along.
    const remote = await fetchRemote(state.remote?.version ?? null, token, key);
    const moving = await fetchPrevious(state.previous);
    if (remote.kind === 'same' && !localChanged && !state.dirty && state.previous.length === 0) {
      const upgraded = state.known !== stored.known;
      updateState(secret, upgraded ? { last: now, known: state.known } : { last: now });
      return true;
    }

    // 3. Merge.
    const merged: Stores = {};
    let kept = 0;
    for (const synced of stores) {
      let result = local[synced.store.key] as StoreSnapshot;
      const known = state.known[synced.store.key];
      const online = remote.kind === 'copy' ? remote.stores[synced.store.key] : undefined;
      if (online) {
        const theirs = upgrade(synced, online);
        // Keeping both needs to know what this device had, in today's data version.
        if (synced.conflictCopy && known?.v === synced.store.version) {
          const both = keepBoth(known, result, theirs, synced.conflictCopy, now);
          result = both.snapshot;
          kept += both.kept;
        }
        result = merge(result, theirs);
      }
      for (const old of moving) {
        const theirs = old.stores[synced.store.key];
        if (theirs) result = merge(result, upgrade(synced, theirs));
      }
      merged[synced.store.key] = prune(result, now);
    }

    // 4. Save the result here (unless the person edited something, or turned
    // sync off, meanwhile), and show it straight away. The page keeps its own
    // copy of the data and saves from it: it must never save what it showed
    // before over the merge, even if the upload below fails.
    checkStillOn(secret);
    let appChanged = false;
    try {
      for (const synced of stores) {
        const result = merged[synced.store.key] as StoreSnapshot;
        const current = synced.store.load();
        if (canonical(current) !== before[synced.store.key]) return false;
        const next = synced.withItems(current, valuesOf(result) as Identified[]);
        if (synced.store.read(synced.store.version, next) === undefined)
          throw new SyncError('server');
        if (canonical(next) === before[synced.store.key]) continue;
        if (!synced.store.save(next)) throw new SyncError('storage');
        appChanged = true;
      }
    } finally {
      if (appChanged) options.onChange();
    }
    keptBoth += kept;

    // 5. Upload, if the copy online isn't already this.
    let online =
      remote.kind === 'copy' ? { version: remote.version, epoch: remote.epoch } : state.remote;
    const same =
      remote.kind === 'same'
        ? !localChanged && !state.dirty && moving.length === 0
        : remote.kind === 'copy' &&
          stores.every(
            (synced) =>
              canonical(merged[synced.store.key]) === canonical(remote.stores[synced.store.key]),
          );
    if (!same) {
      // Remember the merge first: if the upload fails, the next round uploads it
      // as it is, instead of mistaking it for new edits made on this device.
      if (!updateState(secret, { known: knownsOf(merged), dirty: true })) {
        throw new SyncError('storage');
      }
      const data = await sealStores(key, options.app, merged);
      if (data.length > MAX_SEALED_CHARS) throw new SyncError('too-big');
      const base = remote.kind === 'none' ? null : (online?.version ?? null);
      const response = await api(
        '/copy',
        { method: 'PUT', body: JSON.stringify({ base, data }) },
        token,
      );
      // Another device wrote first: merge again with the newer copy.
      if (response.status === 409) return false;
      if (response.status === 410) throw await goneError(response);
      if (response.status === 413) throw new SyncError('too-big');
      if (!response.ok) throw new SyncError(response.status >= 500 ? 'offline' : 'server');
      online = (await response.json()) as { version: number; epoch: string };
    }

    // 6. Remember.
    const saved = { remote: online, known: knownsOf(merged), dirty: false, last: now };
    if (!updateState(secret, saved)) throw new SyncError('storage');

    // 7. The old copies are in the new one now (and their files, re-sealed with
    // the new key, and the app's linked data): delete them, so devices still
    // using them stop.
    if (state.previous.length > 0) {
      for (const old of moving) {
        if (files) await moveFiles(files, old, { token, key });
        if (linked) await linked.move(old.secret, fromBase64Url(secret));
        const response = await api('/copy?moved', { method: 'DELETE' }, old.token);
        if (!response.ok) throw failed(response);
      }
      if (!updateState(secret, { previous: [] })) throw new SyncError('storage');
    }
    return true;
  }

  const knownsOf = (merged: Stores): Record<string, Known> =>
    Object.fromEntries(Object.entries(merged).map(([key, snapshot]) => [key, knownFrom(snapshot)]));

  // ---------- Files ----------

  /** The account's files online, and the copy's version. */
  async function listFiles(token: string): Promise<FileList> {
    const response = await api('/files', {}, token);
    if (response.status === 410) throw await goneError(response);
    if (response.status === 429) throw new PausedError();
    if (!response.ok) throw failed(response);
    return (await response.json()) as FileList;
  }

  /** One file from online, opened; null if it isn't there. */
  async function fetchFile({ token, key }: Keys, id: string) {
    const response = await api(`/files/${id}`, {}, token);
    if (response.status === 404) return null;
    if (response.status === 429) throw new PausedError();
    if (!response.ok) throw failed(response);
    const sealed = new Uint8Array(await response.arrayBuffer());
    return openBytes(key, sealed, fileLabel(options.app, id)).catch(() => null);
  }

  /** Seals a file and puts it online (one too big to sync just stays here). */
  async function putFile({ token, key }: Keys, id: string, bytes: Uint8Array<ArrayBuffer>) {
    const sealed = await sealBytes(key, bytes, fileLabel(options.app, id));
    if (sealed.length > MAX_FILE_BYTES) return;
    const response = await api(`/files/${id}`, { method: 'PUT', body: sealed }, token);
    if (response.status === 413) return;
    if (response.status === 507) throw new SyncError('files-full');
    if (response.status === 410) throw await goneError(response);
    if (response.status === 429) throw new PausedError();
    if (!response.ok) throw failed(response);
  }

  /** Puts this device's copy of a file online, if it has one. */
  async function uploadFile(synced: SyncedFiles, keys: Keys, id: string) {
    const bytes = await synced.read(id).catch(() => null);
    if (bytes) await putFile(keys, id, bytes);
  }

  /**
   * Deletes a file online, but only if the copy is still the one this device
   * synced (the server checks): false if it changed, so a file another device
   * has just started using again is never deleted. Sync again first.
   */
  async function deleteFile({ token }: Keys, id: string, base: number) {
    const response = await api(`/files/${id}?base=${base}`, { method: 'DELETE' }, token);
    if (response.status === 409) return false;
    if (response.status === 410) throw await goneError(response);
    if (response.status === 429) throw new PausedError();
    if (!response.ok) throw failed(response);
    return true;
  }

  /** The device's keys and file lists, unless files wait (sync off, or "too many changes"). */
  async function fileWork(now: number) {
    const state = loadState();
    const lists = loadFiles();
    if (!state?.secret || (lists.paused !== null && now < lists.paused)) return null;
    return { state, lists, keys: await syncKeys(fromBase64Url(state.secret)) };
  }

  const dequeue = (list: 'uploads' | 'removals', id: string) =>
    updateFiles((current) => ({ ...current, [list]: current[list].filter((x) => x !== id) }));

  /** Puts a file online; false if there's no room for it (the daily check tries again). */
  async function upload(synced: SyncedFiles, keys: Keys, id: string): Promise<boolean> {
    try {
      await uploadFile(synced, keys, id);
      return true;
    } catch (error) {
      if (!(error instanceof SyncError && error.problem === 'files-full')) throw error;
      noRoom = true;
      return false;
    }
  }

  /** "Too many changes": files wait a while, without bothering anyone. */
  function pauseOn(error: unknown): void {
    if (!(error instanceof PausedError)) throw error;
    updateFiles((current) => ({ ...current, paused: Date.now() + FILES_PAUSE_MS }));
  }

  /**
   * Before a sync: files saved here go online, so other devices find them
   * as soon as the data that uses them arrives.
   */
  async function uploadFiles(synced: SyncedFiles): Promise<void> {
    const work = await fileWork(Date.now());
    if (!work || work.lists.uploads.length === 0) return;
    // Read together with the list, so a file just saved is in both or neither.
    const wanted = synced.wanted();
    try {
      for (const id of work.lists.uploads) {
        if (wanted.has(id) && !(await upload(synced, work.keys, id))) {
          dequeue('uploads', id);
          return;
        }
        dequeue('uploads', id);
      }
    } catch (error) {
      pauseOn(error);
    }
  }

  /**
   * After a sync: files deleted here are deleted online, and once a day every
   * file is checked against the online list (missing ones go up, unused ones
   * older than a day are deleted). Deleting only works while the copy online
   * is still the one this device just synced (the server checks), so a file
   * another device has started using again is never deleted. Returns false
   * if it should run again after another sync.
   */
  async function tidyFiles(synced: SyncedFiles): Promise<boolean> {
    const now = Date.now();
    const work = await fileWork(now);
    if (!work?.state.remote) return true;
    const { removals, checked } = work.lists;
    const due = checked === null || now - checked >= CHECK_FILES_MS;
    if (removals.length === 0 && !due) return true;
    const wanted = synced.wanted();
    const { keys } = work;
    const base = work.state.remote.version;
    try {
      for (const id of removals) {
        if (!wanted.has(id) && !(await deleteFile(keys, id, base))) return false;
        dequeue('removals', id);
      }
      if (!due) return true;
      const online = await listFiles(keys.token);
      for (const id of wanted) {
        if (Object.hasOwn(online.files, id) || !FILE_ID.test(id)) continue;
        if (!(await upload(synced, keys, id))) break;
      }
      if (online.version !== base) return false;
      for (const [id, [, at]] of Object.entries(online.files)) {
        if (wanted.has(id) || online.now - at < NEW_FILE_MS) continue;
        if (!(await deleteFile(keys, id, base))) return false;
      }
      updateFiles((current) => ({ ...current, checked: now }));
    } catch (error) {
      pauseOn(error);
    }
    return true;
  }

  /** Brings a replaced key's files to the new key, re-sealed (the ones the data uses). */
  async function moveFiles(synced: SyncedFiles, from: Keys, to: Keys): Promise<void> {
    let theirs: FileList;
    try {
      theirs = await listFiles(from.token);
    } catch (error) {
      if (isGone(error)) return;
      throw error;
    }
    const ours = await listFiles(to.token);
    const wanted = synced.wanted();
    for (const id of Object.keys(theirs.files)) {
      if (!wanted.has(id) || Object.hasOwn(ours.files, id)) continue;
      const bytes = (await synced.read(id).catch(() => null)) ?? (await fetchFile(from, id));
      if (bytes) await putFile(to, id, bytes);
    }
  }

  async function run(): Promise<void> {
    if (!isSyncOn()) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    keptBoth = 0;
    emit();
    let event: SyncEvent | undefined;
    try {
      noRoom = false;
      if (files) await uploadFiles(files);
      let done = false;
      for (let attempt = 0; attempt < MAX_ROUNDS && !done; attempt += 1) done = await round();
      if (done && files) done = await tidyFiles(files);
      if (!done) again = true;
      problem = noRoom ? 'files-full' : null;
      event = keptBoth > 0 ? 'kept-both' : 'synced';
    } catch (error) {
      // Stopped: sync was turned off meanwhile, which says so itself.
      if (error instanceof StoppedError) problem = null;
      else problem = error instanceof SyncError ? error.problem : 'server';
      const state = loadState();
      if (state && isGone(error)) {
        saveState(offState(state));
        forgetFiles();
      }
    } finally {
      busy = false;
    }
    emit(event);
    if (again) {
      again = false;
      schedule(CHANGE_DELAY_MS);
    }
  }

  function schedule(delay: number): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), delay);
  }

  /** Coming back from the hub with "#connect=…". */
  async function finishConnect(): Promise<void> {
    const result = parseConnectResult(location.hash);
    if (!result) return;
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    let pending: PendingConnect | null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as PendingConnect | null;
      sessionStorage.removeItem(PENDING_KEY);
    } catch {
      pending = null;
    }
    if (result.kind === 'cancelled') {
      emit('cancelled');
      return;
    }
    try {
      if (!pending || Date.now() - pending.at > CONNECT_LIFETIME_MS) throw new Error('No request');
      const connection = await openConnection(options.app, pending, result);
      if (!saveConnection(connection)) throw new SyncError('storage');
      problem = null;
      emit('connected');
      await run();
    } catch (error) {
      problem = error instanceof SyncError ? error.problem : 'connect-failed';
      emit();
    }
  }

  /**
   * From the hub's list of apps: "Turn off sync in …". Only the account this
   * app syncs with can make the proof, so a link from anyone else can't.
   */
  async function turnOffFromHub(proof: string): Promise<void> {
    const state = loadState();
    if (state?.secret && proof !== (await turnOffProof(fromBase64Url(state.secret)))) {
      emit('kept-on');
      schedule(0);
      return;
    }
    client.turnOff();
  }

  const client: SyncClient = {
    status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    changed() {
      const state = loadState();
      if (state?.secret) schedule(CHANGE_DELAY_MS);
      else if (state) rememberWhileOff(state);
    },
    syncNow: () => run(),
    async connect() {
      const response = await api('/hub');
      if (!response.ok) throw new SyncError('server');
      const { origin } = (await response.json()) as { origin: string };
      const { request, pending } = await newConnectRequest(options.app, location.origin);
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      } catch {
        throw new SyncError('storage');
      }
      location.assign(connectUrl(origin, request));
    },
    turnOff() {
      const state = loadState();
      if (state) saveState(offState(state));
      forgetFiles();
      problem = null;
      emit('turned-off');
    },
    async deleteOnline() {
      const state = loadState();
      if (!state?.secret) return;
      if (linked) await linked.delete(fromBase64Url(state.secret));
      const { token } = await syncKeys(fromBase64Url(state.secret));
      const response = await api('/copy', { method: 'DELETE' }, token);
      if (!response.ok) throw failed(response);
      saveState(offState(state));
      forgetFiles();
      problem = null;
      emit('deleted-online');
    },
    filesAdded(ids) {
      if (files && isSyncOn() && ids.length > 0) {
        updateFiles((current) => ({
          ...current,
          uploads: [...new Set([...current.uploads, ...ids])],
        }));
      }
    },
    filesRemoved(ids) {
      if (files && isSyncOn() && ids.length > 0) {
        updateFiles((current) => ({
          ...current,
          removals: [...new Set([...current.removals, ...ids])],
        }));
      }
    },
    async download(id) {
      const state = loadState();
      if (!files || !state?.secret || !FILE_ID.test(id)) return null;
      try {
        return await fetchFile(await syncKeys(fromBase64Url(state.secret)), id);
      } catch {
        return null;
      }
    },
    secret() {
      const secret = loadState()?.secret;
      return secret ? fromBase64Url(secret) : null;
    },
  };

  /**
   * Sync is off but was on before: keep track of when items are edited or
   * deleted here, so turning it on again merges them properly.
   */
  function rememberWhileOff(state: DeviceState): void {
    const now = Date.now();
    const known = { ...state.known };
    let changed = false;
    for (const synced of stores) {
      const before = known[synced.store.key];
      if (!before || unsyncable(synced, before)) continue;
      const seen = observe(before, synced.items(synced.store.load()), synced.store.version, now);
      if (!seen.changed) continue;
      known[synced.store.key] = knownFrom(prune(seen.snapshot, now));
      changed = true;
    }
    if (changed) saveState({ ...state, known });
  }

  // After an update that changed a data version: bring what this device knew
  // to the new version now, while the data is still saved in the old one (the
  // app's next save changes that), even if sync is off or there's no connection.
  const start = loadState();
  if (start) {
    const known = knownNow(stores, start.known);
    if (known !== start.known) saveState({ ...start, known });
  }

  // Keep up with other devices while the app is open.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(0);
  });
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('storage', (event) => {
    if (event.key === STATE_KEY || event.key === null) emit();
  });
  window.setInterval(() => {
    if (document.visibilityState === 'visible' && !busy) void run();
  }, POLL_MS);

  // A moment later, so the page can subscribe first and see what happened.
  const turnOff = parseTurnOff(location.hash);
  if (parseConnectResult(location.hash)) {
    window.setTimeout(() => void finishConnect(), 0);
  } else if (location.hash === '#sync=connect') {
    // From the hub's list of apps: "Turn on sync" straight away.
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    window.setTimeout(() => {
      client.connect().catch(() => {
        problem = 'connect-failed';
        emit();
      });
    }, 0);
  } else if (turnOff) {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    window.setTimeout(() => void turnOffFromHub(turnOff), 0);
  } else if (isSyncOn()) {
    schedule(0);
  }
  return client;
}
