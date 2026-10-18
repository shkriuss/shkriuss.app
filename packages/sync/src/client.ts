/**
 * Syncing an app's data between devices, browser side (docs/adr/0010).
 *
 *   const sync = createSync({ app: 'tally', stores: [...], onChange: rerender });
 *   sync.changed();   // after every save: syncs a moment later
 *   sync.connect();   // "Turn on sync": goes to the hub's Account page and back
 *
 * Opening the app with "#sync=connect" (from the hub's list of apps) starts
 * "Turn on sync" straight away.
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
 */
import { fromBase64Url, toBase64Url } from '@shkriuss/crypto';
import type { Store } from '@shkriuss/storage';
import {
  CONNECT_LIFETIME_MS,
  connectUrl,
  type Connection,
  newConnectRequest,
  openConnection,
  parseConnectResult,
  type PendingConnect,
} from './connect.ts';
import {
  canonical,
  keepBoth,
  knownFrom,
  merge,
  observe,
  prune,
  valuesOf,
  type Identified,
  type Known,
  type StoreSnapshot,
} from './merge.ts';
import { openStores, sealStores, syncKeys, type Stores } from './snapshot.ts';

export { secondVersionName } from './merge.ts';
import { MAX_SEALED_CHARS } from './validate.ts';

const STATE_KEY = 'shkriuss-device:sync';
const PENDING_KEY = 'shkriuss-device:connect';
const API = '/api/sync';
/** After a change, wait this long so quick edits go up together. */
const CHANGE_DELAY_MS = 1500;
/** While the app is open and visible, look for changes from other devices this often. */
const POLL_MS = 60 * 1000;
/** Merge again at most this many times in a row when another device writes first. */
const MAX_ROUNDS = 3;

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
  /** Too much data to sync. */
  | 'too-big'
  /** The online copy was deleted on another device; sync is now off here. */
  | 'deleted'
  /** The account key was replaced on another device, which moved the copy; sync is now off here. */
  | 'moved'
  /** This browser won't save. */
  | 'storage'
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
  /** Deletes the online copy and stops syncing on this device. Data here stays. */
  deleteOnline(): Promise<void>;
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
      previous: Array.isArray(state.previous)
        ? state.previous.filter((key): key is string => typeof key === 'string')
        : [],
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

/** Whether this device syncs this app. */
export const isSyncOn = (): boolean => typeof loadState()?.secret === 'string';

/**
 * Stops syncing on this device and forgets what it knew, so a later "Turn on
 * sync" starts like the first time (what's online wins). For when all data is
 * deleted here, or replaced from a backup. Never throws.
 */
export function stopSync(): void {
  saveState(null);
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

async function api(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
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

/** A 410 from the server: the copy was deleted, or moved to a new account key. */
async function goneError(response: Response): Promise<SyncError> {
  const body = (await response.json().catch(() => null)) as { moved?: unknown } | null;
  return new SyncError(body?.moved === true ? 'moved' : 'deleted');
}

const isGone = (error: unknown): boolean =>
  error instanceof SyncError && (error.problem === 'deleted' || error.problem === 'moved');

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
}): SyncClient {
  const { stores } = options;
  const listeners = new Set<(status: SyncStatus, event?: SyncEvent) => void>();
  let busy = false;
  /** Items kept in both versions during this run (see SyncedStore.conflictCopy). */
  let keptBoth = 0;
  let again = false;
  let problem: SyncProblem | null = null;
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
    const items = { ...remote.items };
    for (const item of synced.items(upgraded)) {
      const entry = items[item.id];
      if (entry && !('deleted' in entry)) items[item.id] = { t: entry.t, value: item };
    }
    return { ...remote, v: synced.store.version, items };
  }

  /** The online copies of replaced keys still to move here (gone ones have nothing to bring). */
  async function fetchPrevious(previous: readonly string[]) {
    const copies: { token: string; stores: Stores }[] = [];
    for (const secret of previous) {
      const { token, key } = await syncKeys(fromBase64Url(secret));
      try {
        const remote = await fetchRemote(null, token, key);
        if (remote.kind === 'copy') copies.push({ token, stores: remote.stores });
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
    const state = loadState();
    if (!state?.secret) return true;
    const { token, key } = await syncKeys(fromBase64Url(state.secret));
    const now = Date.now();

    // 1. This device.
    const { before, local, changed: localChanged } = observeAll(state, now);

    // 2. The online copy, and any old copies to bring along.
    const remote = await fetchRemote(state.remote?.version ?? null, token, key);
    const moving = await fetchPrevious(state.previous);
    if (remote.kind === 'same' && !localChanged && !state.dirty && state.previous.length === 0) {
      saveState({ ...state, last: now });
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

    // 4. Save the result here (unless the person edited something meanwhile).
    let appChanged = false;
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
      if (!saveState({ ...state, known: knownsOf(merged), dirty: true })) {
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
      if (response.status === 409) {
        // Another device wrote first: merge again with the newer copy.
        if (appChanged) options.onChange();
        return false;
      }
      if (response.status === 410) throw await goneError(response);
      if (response.status === 413) throw new SyncError('too-big');
      if (!response.ok) throw new SyncError(response.status >= 500 ? 'offline' : 'server');
      online = (await response.json()) as { version: number; epoch: string };
    }

    // 6. Remember.
    const saved = { ...state, remote: online, known: knownsOf(merged), dirty: false, last: now };
    if (!saveState(saved)) throw new SyncError('storage');
    if (appChanged) options.onChange();

    // 7. The old copies are in the new one now: delete them, so devices still using them stop.
    if (state.previous.length > 0) {
      for (const { token: old } of moving) {
        const response = await api('/copy?moved', { method: 'DELETE' }, old);
        if (!response.ok) throw new SyncError(response.status >= 500 ? 'offline' : 'server');
      }
      if (!saveState({ ...saved, previous: [] })) throw new SyncError('storage');
    }
    return true;
  }

  const knownsOf = (merged: Stores): Record<string, Known> =>
    Object.fromEntries(Object.entries(merged).map(([key, snapshot]) => [key, knownFrom(snapshot)]));

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
      let done = false;
      for (let attempt = 0; attempt < MAX_ROUNDS && !done; attempt += 1) done = await round();
      if (!done) again = true;
      problem = null;
      event = keptBoth > 0 ? 'kept-both' : 'synced';
    } catch (error) {
      problem = error instanceof SyncError ? error.problem : 'server';
      const state = loadState();
      if (state && isGone(error)) saveState(offState(state));
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
      problem = null;
      emit('turned-off');
    },
    async deleteOnline() {
      const state = loadState();
      if (!state?.secret) return;
      const { token } = await syncKeys(fromBase64Url(state.secret));
      const response = await api('/copy', { method: 'DELETE' }, token);
      if (!response.ok) throw new SyncError(response.status >= 500 ? 'offline' : 'server');
      saveState(offState(state));
      problem = null;
      emit('deleted-online');
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
      if (!before) continue;
      const seen = observe(before, synced.items(synced.store.load()), synced.store.version, now);
      if (!seen.changed) continue;
      known[synced.store.key] = knownFrom(prune(seen.snapshot, now));
      changed = true;
    }
    if (changed) saveState({ ...state, known });
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
  } else if (isSyncOn()) {
    schedule(0);
  }
  return client;
}
