/**
 * Syncing an app's data between devices, browser side (docs/adr/0010).
 *
 *   const sync = createSync({ app: 'tally', stores: [...], onChange: rerender });
 *   sync.changed();   // after every save: syncs a moment later
 *   sync.connect();   // "Turn on sync": goes to the hub's Account page and back
 *
 * Each round: read this device's items, fetch the online copy if it changed,
 * merge (./merge.ts: newest edit of each item wins, deletions sync), save the
 * result here, and upload it if it differs. The copy is sealed on the device
 * (./snapshot.ts). Conflicting uploads from two devices are caught by the
 * server (version numbers) and simply merged again.
 *
 * This device's sync key and what it knew at the last sync are kept under
 * "shkriuss-device:", which backups skip.
 */
import { fromBase64Url, toBase64Url } from '@shkriuss/crypto';
import type { Store } from '@shkriuss/storage';
import {
  CONNECT_LIFETIME_MS,
  connectUrl,
  newConnectRequest,
  openConnection,
  parseConnectResult,
  type PendingConnect,
} from './connect.ts';
import {
  canonical,
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
export type SyncEvent = 'connected' | 'cancelled' | 'synced' | 'turned-off' | 'deleted-online';

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
  /** The app's own key (from the account), base64url. */
  secret: string;
  code: string;
  /** The online copy's version and lineage when last seen. */
  remote: { version: number; epoch: string } | null;
  /** What this device knew at the last sync, per store key. */
  known: Record<string, Known>;
  /** True when `known` holds a merge that isn't online yet (the upload failed). */
  dirty: boolean;
  last: number | null;
}

function loadState(): DeviceState | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return null;
    const state = value as Partial<DeviceState>;
    return typeof state.secret === 'string' && typeof state.code === 'string'
      ? {
          secret: state.secret,
          code: state.code,
          remote: state.remote ?? null,
          known: state.known ?? {},
          dirty: state.dirty === true,
          last: state.last ?? null,
        }
      : null;
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
export const isSyncOn = (): boolean => loadState() !== null;

/** Stops syncing on this device (e.g. when all data is deleted here). Never throws. */
export function stopSync(): void {
  saveState(null);
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
  let again = false;
  let problem: SyncProblem | null = null;
  let timer: number | undefined;

  const status = (): SyncStatus => {
    const state = loadState();
    return {
      on: state !== null,
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

  async function fetchRemote(state: DeviceState, token: string, key: Uint8Array<ArrayBuffer>) {
    const since = state.remote ? `?since=${state.remote.version}` : '';
    const response = await api(`/copy${since}`, {}, token);
    if (response.status === 204) return { kind: 'same' } as Remote;
    if (response.status === 410) throw new SyncError('deleted');
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

  /** One round. Returns false if it should run again (another device wrote first, or a local edit). */
  async function round(): Promise<boolean> {
    const state = loadState();
    if (!state) return true;
    const { token, key } = await syncKeys(fromBase64Url(state.secret));
    const now = Date.now();

    // 1. This device.
    const before: Record<string, string> = {};
    const local: Stores = {};
    let localChanged = false;
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
      localChanged ||= seen.changed;
    }

    // 2. The online copy.
    const remote = await fetchRemote(state, token, key);
    if (remote.kind === 'same' && !localChanged && !state.dirty) {
      saveState({ ...state, last: now });
      return true;
    }

    // 3. Merge.
    const merged: Stores = {};
    for (const synced of stores) {
      const mine = local[synced.store.key] as StoreSnapshot;
      const theirs = remote.kind === 'copy' ? remote.stores[synced.store.key] : undefined;
      merged[synced.store.key] = prune(theirs ? merge(mine, upgrade(synced, theirs)) : mine, now);
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

    // 5. Upload, if the copy online isn't already this.
    let online =
      remote.kind === 'copy' ? { version: remote.version, epoch: remote.epoch } : state.remote;
    const same =
      remote.kind === 'same'
        ? !localChanged && !state.dirty
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
      if (response.status === 410) throw new SyncError('deleted');
      if (response.status === 413) throw new SyncError('too-big');
      if (!response.ok) throw new SyncError(response.status >= 500 ? 'offline' : 'server');
      online = (await response.json()) as { version: number; epoch: string };
    }

    // 6. Remember.
    if (
      !saveState({ ...state, remote: online, known: knownsOf(merged), dirty: false, last: now })
    ) {
      throw new SyncError('storage');
    }
    if (appChanged) options.onChange();
    return true;
  }

  const knownsOf = (merged: Stores): Record<string, Known> =>
    Object.fromEntries(Object.entries(merged).map(([key, snapshot]) => [key, knownFrom(snapshot)]));

  async function run(): Promise<void> {
    if (!loadState()) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    emit();
    let event: SyncEvent | undefined;
    try {
      let done = false;
      for (let attempt = 0; attempt < MAX_ROUNDS && !done; attempt += 1) done = await round();
      if (!done) again = true;
      problem = null;
      event = 'synced';
    } catch (error) {
      problem = error instanceof SyncError ? error.problem : 'server';
      if (problem === 'deleted') stopSync();
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
      if (
        !saveState({
          secret: toBase64Url(connection.secret),
          code: connection.code,
          remote: null,
          known: {},
          dirty: false,
          last: null,
        })
      ) {
        throw new SyncError('storage');
      }
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
      if (loadState()) schedule(CHANGE_DELAY_MS);
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
      stopSync();
      problem = null;
      emit('turned-off');
    },
    async deleteOnline() {
      const state = loadState();
      if (!state) return;
      const { token } = await syncKeys(fromBase64Url(state.secret));
      const response = await api('/copy', { method: 'DELETE' }, token);
      if (!response.ok) throw new SyncError(response.status >= 500 ? 'offline' : 'server');
      stopSync();
      problem = null;
      emit('deleted-online');
    },
  };

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
  if (parseConnectResult(location.hash)) window.setTimeout(() => void finishConnect(), 0);
  else if (loadState()) schedule(0);
  return client;
}
