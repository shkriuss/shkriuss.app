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
 *
 * In other files: this device's state (./device.ts), requests to the server
 * (./requests.ts) and files (./files.ts).
 */
import { fromBase64Url } from '@shkriuss/crypto';
import { isStorageFull, lastSaveProblem, type Store } from '@shkriuss/storage';
import {
  CONNECT_LIFETIME_MS,
  connectUrl,
  newConnectRequest,
  openConnection,
  parseConnectResult,
  parseTurnOff,
  type PendingConnect,
  turnOffProof,
} from './connect.ts';
import {
  checkStillOn,
  forgetFiles,
  isSyncOn,
  loadState,
  offState,
  saveConnection,
  saveState,
  STATE_KEY,
  stateProblem,
  StoppedError,
  updateFiles,
  updateState,
  type DeviceState,
} from './device.ts';
import { createFileSync, type SyncedFiles } from './files.ts';
import {
  byId,
  canonical,
  dropForgotten,
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
import {
  api,
  failed,
  goneError,
  isGone,
  problemOf,
  serverClock,
  SyncError,
  type Keys,
  type SyncProblem,
} from './requests.ts';
import {
  openStores,
  sealStores,
  SYNC_VERSION,
  syncKeys,
  type OpenedCopy,
  type Stores,
} from './snapshot.ts';
import { FILE_ID, MAX_SEALED_CHARS } from './validate.ts';

export { isSyncOn, saveConnection, stopSync } from './device.ts';
export type { SyncedFiles } from './files.ts';
export { fingerprint, secondVersionName } from './merge.ts';
export type { SyncProblem } from './requests.ts';

const PENDING_KEY = 'shkriuss-device:connect';
/** After a change, wait this long so quick edits go up together. */
const CHANGE_DELAY_MS = 1500;
/** While the app is open and visible, look for changes from other devices this often. */
const POLL_MS = 60 * 1000;
/** Merge again at most this many times in a row when another device writes first. */
const MAX_ROUNDS = 3;

/** A copy the server sent that can't be opened: from a newer version, damaged, or too big. */
class UnopenedCopyError extends SyncError {}

/**
 * Whether a store's value keeps every item merged into it as it was. An app
 * drops or changes items it can't read (a setting a newer version added, say),
 * and those would then spread as this device's own deletions and edits.
 */
function keepsAll(synced: SyncedStore, value: unknown, merged: readonly Identified[]): boolean {
  const kept = new Map(synced.items(value).map((item) => [item.id, canonical(item)]));
  return merged.every((item) => kept.get(item.id) === canonical(item));
}
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
   * is deleted next. Also when another device moved the old copy first: if
   * that was a lost device, it may have moved this data for itself, which
   * the app needs to find out. If it throws, the next sync tries again.
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
  /**
   * The time to count back from when deleting data by age (ms), like Water's
   * drinks older than a year. While sync is on, deletions here reach the
   * other devices, so a clock set far ahead mustn't decide: it's this
   * device's clock, but never later than the sync server's at the last sync.
   * Null when that isn't known yet (synced before it was kept): then wait.
   * With sync off (or never used) it's this device's clock, so data still
   * goes on time, however long sync stays off. Deletions made while it's off
   * reach the others only if it's turned on again (audit F1-4).
   */
  trustedNow(): number | null;
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

/** The online copy, or why there isn't one. */
type Remote =
  | { kind: 'same' }
  | { kind: 'none' }
  | { kind: 'copy'; version: number; epoch: string; stores: Stores; written: number | null };

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
  let timer: number | undefined;
  const fileSync = createFileSync(options.app);

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
    if (!response.ok) throw failed(response);
    const copy = (await response.json()) as { version: number; epoch?: string; data?: string };
    if (copy.data === undefined || copy.epoch === undefined) return { kind: 'none' } as Remote;
    let opened: OpenedCopy;
    try {
      opened = await openStores(key, options.app, copy.data);
    } catch (error) {
      throw new UnopenedCopyError(error instanceof RangeError ? 'update-needed' : 'server');
    }
    const { version, epoch } = copy;
    return { kind: 'copy', version, epoch, ...opened } as Remote;
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

  /** This app's data versions: an old copy that needs newer ones is tried again once they change. */
  const versions = [SYNC_VERSION, ...stores.map((synced) => synced.store.version)].join(' ');

  /**
   * An old copy's stores in this app's data versions, ready to merge, or
   * "wait" if one needs a newer version of the app or fails the store's own
   * checks (then it can't be merged, but nothing in it is lost).
   */
  function readOld(old: Stores): Stores | 'wait' {
    const ready: Stores = {};
    try {
      for (const synced of stores) {
        const snapshot = old[synced.store.key];
        if (!snapshot) continue;
        if (snapshot.v > synced.store.version) return 'wait';
        const upgraded = upgrade(synced, snapshot);
        const values = valuesOf(upgraded) as Identified[];
        const value = synced.withItems(synced.store.empty(), values);
        if (synced.store.read(synced.store.version, value) === undefined) return 'wait';
        if (!keepsAll(synced, value, values)) return 'wait';
        ready[synced.store.key] = upgraded;
      }
    } catch {
      return 'wait';
    }
    return ready;
  }

  /**
   * The online copies of replaced keys still to move here (gone ones have
   * nothing to bring; a key with nothing online moves as an empty copy), the
   * replaced keys whose copy another device moved, and those whose copy
   * waits for a newer version of the app.
   *
   * A device with the old key (a lost one) can write anything to its copy,
   * so nothing in it may stop syncing with the new key (audit A-1): a copy
   * that doesn't open has nothing to bring, and is retired all the same; one
   * from a newer version of the app, or that fails the checks, waits, and is
   * tried again only after this app updates.
   */
  async function fetchPrevious(previous: readonly string[], waited: Record<string, string>) {
    const copies: (Keys & { secret: Uint8Array<ArrayBuffer>; stores: Stores })[] = [];
    const movedAway: Uint8Array<ArrayBuffer>[] = [];
    const waiting: Record<string, string> = {};
    for (const encoded of previous) {
      if (waited[encoded] === versions) {
        waiting[encoded] = versions;
        continue;
      }
      const secret = fromBase64Url(encoded);
      const { token, key } = await syncKeys(secret);
      let ready: Stores | 'wait';
      try {
        const remote = await fetchRemote(null, token, key);
        // Nothing online for the old key (never synced, or deleted half-way)
        // still gets the "moved" note below, so a lost device with that key
        // can't start it again (audit 3 B-1).
        ready = remote.kind === 'copy' ? readOld(remote.stores) : {};
      } catch (error) {
        if (error instanceof UnopenedCopyError) {
          ready = error.problem === 'update-needed' ? 'wait' : {};
        } else {
          if (!isGone(error)) throw error;
          if (error instanceof SyncError && error.problem === 'moved') movedAway.push(secret);
          continue;
        }
      }
      if (ready === 'wait') waiting[encoded] = versions;
      else copies.push({ secret, token, key, stores: ready });
    }
    return { copies, movedAway, waiting };
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
    const {
      copies: moving,
      movedAway,
      waiting,
    } = await fetchPrevious(state.previous, state.waiting);
    const stillWaiting = Object.keys(waiting);
    if (
      remote.kind === 'same' &&
      !localChanged &&
      !state.dirty &&
      state.previous.length === stillWaiting.length
    ) {
      const upgraded = state.known !== stored.known;
      updateState(secret, {
        last: now,
        waiting,
        ...answered(),
        ...(upgraded ? { known: state.known } : {}),
      });
      return true;
    }

    // A copy older than one this device saw (the server restored from a
    // backup, or sending an old copy again) is merged like a device that was
    // away for a while, but what it lacks isn't taken as deleted (audit A-8).
    // The version is the server's word; how many times the copy was written
    // is sealed in it, so a copy that doesn't say, after one that did, is
    // older too, whatever version the server gives it (audit 3 B-3).
    const last =
      remote.kind === 'copy' && state.remote?.epoch === remote.epoch ? state.remote : null;
    const older =
      remote.kind === 'copy' &&
      last !== null &&
      (remote.version < last.version || (remote.written ?? 0) < (last.written ?? 0));
    /** The most times this copy was written, as far as this device knows. */
    const written =
      remote.kind === 'copy'
        ? Math.max(remote.written ?? 0, last?.written ?? 0)
        : remote.kind === 'same'
          ? (state.remote?.written ?? 0)
          : 0;

    // 3. Merge.
    const merged: Stores = {};
    /** What the online copy holds now, as this device has seen it. */
    const seen: Record<string, Known> = {};
    let kept = 0;
    for (const synced of stores) {
      const { version } = synced.store;
      let result = local[synced.store.key] as StoreSnapshot;
      const known = state.known[synced.store.key];
      const online = remote.kind === 'copy' ? remote.stores[synced.store.key] : undefined;
      if (online) {
        const theirs = upgrade(synced, online);
        seen[synced.store.key] = knownFrom(theirs);
        // Keeping both compares with the copy as this device last saw it (or
        // what it knew, if it last saw another copy), in today's data version.
        const sameCopy = remote.kind === 'copy' && state.base?.epoch === remote.epoch && !older;
        const base = sameCopy ? state.base?.stores[synced.store.key] : known;
        // Deleted elsewhere longer ago than the markers last: deleted here too.
        if (sameCopy && base) result = dropForgotten(result, theirs, base);
        if (synced.conflictCopy && known?.v === version && base?.v === version) {
          const both = keepBoth(base, result, theirs, synced.conflictCopy, now);
          result = both.snapshot;
          kept += both.kept;
        }
        result = merge(result, theirs);
      }
      for (const old of moving) {
        // Already in this app's data version (readOld).
        const theirs = old.stores[synced.store.key];
        if (theirs) result = merge(result, theirs);
      }
      merged[synced.store.key] = prune(result, now);
    }

    // 4. Save the result here (unless the person edited something, or turned
    // sync off, meanwhile), and show it straight away. The page keeps its own
    // copy of the data and saves from it: it must never save what it showed
    // before over the merge, even if the upload below fails.
    checkStillOn(secret);
    const nexts: unknown[] = [];
    const currents: unknown[] = [];
    for (const synced of stores) {
      const result = merged[synced.store.key] as StoreSnapshot;
      const current = synced.store.load();
      if (canonical(current) !== before[synced.store.key]) return false;
      currents.push(current);
      const values = valuesOf(result) as Identified[];
      const next = synced.withItems(current, values);
      if (synced.store.read(synced.store.version, next) === undefined) {
        throw new SyncError('server');
      }
      // An item this version can't keep as it is (from a newer version, say)
      // would become a deletion or an edit at the next sync, and win on every
      // device: wait for this app to update instead (audit F2-8).
      if (!keepsAll(synced, next, values)) throw new SyncError('update-needed');
      nexts.push(next);
    }
    let appChanged = false;
    /** The stores saved this round: they hold the merge. */
    const changed: number[] = [];
    /**
     * Puts back what the changed stores held before this round. When what
     * this device knew can't be saved after the merge was (storage full),
     * the next round would take what came in for edits made here, newer than
     * every other device's (audit 3 E-1): undone, the round just failed.
     */
    const undo = (): void => {
      for (const index of changed) stores[index]?.store.save(currents[index]);
      changed.length = 0;
    };
    try {
      for (const [index, synced] of stores.entries()) {
        const next = nexts[index];
        if (canonical(next) === before[synced.store.key]) continue;
        if (!synced.store.save(next)) {
          undo();
          throw new SyncError(lastSaveProblem() === 'full' ? 'full' : 'storage');
        }
        changed.push(index);
        appChanged = true;
      }
    } finally {
      if (appChanged) options.onChange();
    }
    keptBoth += kept;
    const stateNotSaved = (): SyncError => {
      if (changed.length > 0) {
        undo();
        options.onChange();
      }
      return new SyncError(stateProblem());
    };

    // 5. Upload, if the copy online isn't already this.
    let online =
      remote.kind === 'copy'
        ? { version: remote.version, epoch: remote.epoch, written }
        : state.remote && { ...state.remote, written };
    const same =
      remote.kind === 'same'
        ? !localChanged && !state.dirty && moving.length === 0
        : remote.kind === 'copy' &&
          stores.every(
            (synced) =>
              canonical(merged[synced.store.key]) === canonical(remote.stores[synced.store.key]),
          );
    const knowns = knownsOf(merged);
    if (!same) {
      // Remember the merge first: if the upload fails, the next round uploads it
      // as it is, instead of mistaking it for new edits made on this device.
      // And remember what was online, for keeping both versions.
      const seenOnline =
        remote.kind === 'copy'
          ? { epoch: remote.epoch, stores: seen }
          : remote.kind === 'none'
            ? null
            : state.base;
      if (!updateState(secret, { known: knowns, dirty: true, base: seenOnline })) {
        throw stateNotSaved();
      }
      // What this device knew says the merge now: nothing to undo.
      changed.length = 0;
      const data = await sealStores(key, options.app, merged, written + 1);
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
      if (!response.ok) throw failed(response);
      const saved = (await response.json()) as { version: number; epoch: string };
      online = { ...saved, written: written + 1 };
    }

    // 6. Remember. The copy online is now the merge.
    const base = online ? { epoch: online.epoch, stores: knowns } : null;
    const saved = { remote: online, known: knowns, dirty: false, base, last: now, ...answered() };
    if (!updateState(secret, saved)) throw stateNotSaved();

    // 7. The old copies are in the new one now (and their files, re-sealed with
    // the new key, and the app's linked data): delete them, so devices still
    // using them stop. Old copies another device moved first get their linked
    // data moved too: that device may have been the lost one.
    if (state.previous.length > 0) {
      for (const old of moving) {
        if (files) await fileSync.moveFiles(files, old, { token, key });
        if (linked) await linked.move(old.secret, fromBase64Url(secret));
        const response = await api('/copy?moved', { method: 'DELETE' }, old.token);
        if (!response.ok) throw failed(response);
      }
      if (linked) {
        for (const old of movedAway) await linked.move(old, fromBase64Url(secret));
      }
      if (!updateState(secret, { previous: stillWaiting, waiting })) {
        throw new SyncError(stateProblem());
      }
    }
    return true;
  }

  const knownsOf = (merged: Stores): Record<string, Known> =>
    Object.fromEntries(Object.entries(merged).map(([key, snapshot]) => [key, knownFrom(snapshot)]));

  /** The server's clock at its latest answer, to keep with a sync (see trustedNow). */
  const answered = (): Partial<DeviceState> => {
    const time = serverClock();
    return time === null ? {} : { serverTime: time };
  };

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
      fileSync.start();
      if (files) await fileSync.uploadFiles(files);
      let done = false;
      for (let attempt = 0; attempt < MAX_ROUNDS && !done; attempt += 1) done = await round();
      if (done && files) done = await fileSync.tidyFiles(files);
      if (!done) again = true;
      problem = fileSync.noRoom() ? 'files-full' : null;
      event = keptBoth > 0 ? 'kept-both' : 'synced';
    } catch (error) {
      // Stopped: sync was turned off meanwhile, which says so itself.
      if (error instanceof StoppedError) problem = null;
      else problem = problemOf(error);
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
      if (!saveConnection(connection)) throw new SyncError(stateProblem());
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
      } catch (error) {
        throw new SyncError(isStorageFull(error) ? 'full' : 'storage');
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
      // Copies of replaced keys not moved here yet go too, with their linked
      // data: the lost device that has the old key could still read them.
      for (const encoded of state.previous) {
        const old = fromBase64Url(encoded);
        if (linked) await linked.delete(old);
        const response = await api('/copy', { method: 'DELETE' }, (await syncKeys(old)).token);
        if (!response.ok) throw failed(response);
      }
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
        return await fileSync.fetchFile(await syncKeys(fromBase64Url(state.secret)), id);
      } catch {
        return null;
      }
    },
    secret() {
      const secret = loadState()?.secret;
      return secret ? fromBase64Url(secret) : null;
    },
    trustedNow() {
      const state = loadState();
      if (!state?.secret) return Date.now();
      return state.serverTime === null ? null : Math.min(Date.now(), state.serverTime);
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
