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
 * (./requests.ts), files (./files.ts), the links the hub opens the app with
 * (./links.ts) and connecting to the account (./connect.ts, loaded only when
 * sync is turned on or such a link opens the app: audit 5 J-2).
 */
import { fromBase64Url } from '@shkriuss/crypto';
import { isStorageFull, lastSaveProblem, type Store } from '@shkriuss/storage';
import type { PendingConnect } from './connect.ts';
import { CONNECT_LIFETIME_MS, parseConnectResult, parseTurnOff } from './links.ts';
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
  withRetired,
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
  pruneUnsent,
  upgradeKnown,
  valuesOf,
  type Identified,
  type Known,
  type StoreSnapshot,
} from './merge.ts';
import {
  api,
  failed,
  GoneError,
  goneError,
  isGone,
  problemOf,
  serverClock,
  SyncError,
  timeOf,
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
export const CHANGE_DELAY_MS = 1500;
/** While the app is open and visible, look for changes from other devices this often. */
export const POLL_MS = 60 * 1000;
/** Merge again at most this many times in a row when another device writes first. */
const MAX_ROUNDS = 3;
/** While another tab of the app syncs, try again this soon. */
export const TAB_RETRY_MS = 2000;
/**
 * After waiting this long for another tab, sync anyway: a tab frozen in the
 * background, or stuck, while syncing could keep its turn for good.
 */
export const TAB_PATIENCE_MS = 60 * 1000;

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
  /**
   * With conflictCopy: keep both also when the two devices' versions are
   * the same, for items whose changes are events, not edits. Tally's water
   * at 5, counted once on each device, is 6 on both, and that's two glasses,
   * not one (audit 4 F2-3). Text changed the same way on two devices is one
   * edit, so it's off unless asked for. True, or a rule for which values
   * are events: Tally's 0 on both devices is two resets, one change.
   */
  keepSame?: boolean | ((value: I) => boolean);
}

/**
 * Data an app keeps online beside its copy, in a way of its own (like Photos'
 * library, docs/adr/0016): deleted with the copy, and moved with it to a new
 * account key. Each gets the app's own keys from the account, to derive what
 * it needs.
 */
export interface LinkedData {
  /**
   * Before "Delete the online copy" deletes the copy. `online` is every item
   * in that copy (of every store), so data a device that hasn't synced yet
   * knows nothing of is deleted too (audit 4 D-2). If it throws, nothing is
   * deleted.
   */
  delete(secret: Uint8Array<ArrayBuffer>, online: readonly unknown[]): Promise<void>;
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
  /**
   * Stops syncing on this device; the online copy stays for other devices.
   * False if sync couldn't be turned off (the browser won't save anything):
   * then status() says what's wrong.
   */
  turnOff(): boolean;
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

/**
 * The online copy, or why there isn't one. `endedAt`: when the copy before
 * it was deleted, for one started again (see fetchCopy).
 */
type Remote =
  | { kind: 'same' }
  | { kind: 'none' }
  | {
      kind: 'copy';
      version: number;
      epoch: string;
      stores: Stores;
      written: number | null;
      endedAt: number | null;
    };

/**
 * Kept while the person is on the hub after "Turn on sync": the request's
 * key, and when it was pressed by the sync server's clock (see
 * DeviceState.connected; missing if the page was saved by an older version).
 */
type Pending = PendingConnect & { turnedOn?: number };

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
  /**
   * Times sync was turned off, or the online copy deleted, in this tab,
   * which say so themselves: what a sync under way then finds (the copy gone,
   * say) is no news.
   */
  let stops = 0;
  /** Something was edited here (sync on) that no round has noted yet (see rememberEdits). */
  let edited = false;
  /** In the round under way: what this device knew says the merge now (see round()). */
  let knownSaved = false;
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
    const copy = (await response.json()) as {
      version: number;
      epoch?: string;
      data?: string;
      endedAt?: unknown;
    };
    if (copy.data === undefined || copy.epoch === undefined) return { kind: 'none' } as Remote;
    let opened: OpenedCopy;
    try {
      opened = await openStores(key, options.app, copy.data);
    } catch (error) {
      throw new UnopenedCopyError(error instanceof RangeError ? 'update-needed' : 'server');
    }
    const { version, epoch } = copy;
    return { kind: 'copy', version, epoch, endedAt: timeOf(copy.endedAt), ...opened } as Remote;
  }

  /**
   * The online copy, for a round. "Delete the online copy" turns sync off on
   * every device where it was on then, whether it had synced yet or not; one
   * where sync was turned on after the deletion starts a new copy, or joins
   * one another device started, so turning sync on again works (audit 4
   * E-1). Both times are the sync server's.
   */
  async function fetchCopy(
    state: DeviceState,
    token: string,
    key: Uint8Array<ArrayBuffer>,
  ): Promise<Remote> {
    let remote: Remote;
    try {
      remote = await fetchRemote(state.remote?.version ?? null, token, key);
    } catch (error) {
      if (
        error instanceof GoneError &&
        error.problem === 'deleted' &&
        turnedOnSince(state, error.deletedAt)
      ) {
        return { kind: 'none' };
      }
      throw error;
    }
    if (
      remote.kind === 'copy' &&
      remote.endedAt !== null &&
      remote.epoch !== state.remote?.epoch &&
      !turnedOnSince(state, remote.endedAt)
    ) {
      throw new GoneError('deleted', remote.endedAt);
    }
    return remote;
  }

  /** Whether sync was turned on here after `at` (the server's clock). Not known: no. */
  const turnedOnSince = (state: DeviceState, at: number | null): boolean =>
    state.connected !== null && at !== null && state.connected > at;

  /**
   * Every item in an online copy, for deleting the data linked to it: a device
   * that hasn't synced yet has none of them, and would leave that data online
   * (audit 4 D-2). None if the copy is gone, or can't be read (damaged, or
   * from a newer version of the app): the deletion goes ahead without them,
   * as nothing someone with the key wrote in it (a lost device has an old
   * key) may stop it.
   */
  async function onlineItems({ token, key }: Keys): Promise<unknown[]> {
    let remote: Remote;
    try {
      remote = await fetchRemote(null, token, key);
    } catch (error) {
      if (isGone(error) || error instanceof UnopenedCopyError) return [];
      throw error;
    }
    if (remote.kind !== 'copy') return [];
    return Object.values(remote.stores).flatMap((snapshot) => valuesOf(snapshot));
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
    interface Old {
      secret: Uint8Array<ArrayBuffer>;
      encoded: string;
    }
    const copies: (Keys & Old & { stores: Stores })[] = [];
    const movedAway: Old[] = [];
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
          if (error instanceof SyncError && error.problem === 'moved') {
            movedAway.push({ secret, encoded });
            continue;
          }
          // Deleted ("Delete the online copy" with the old key): nothing to
          // bring, but the "moved" note too, as a deleted copy could be
          // started again with the old key (audit 5 A-1).
          ready = {};
        }
      }
      if (ready === 'wait') waiting[encoded] = versions;
      else copies.push({ secret, encoded, token, key, stores: ready });
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
    const state = {
      ...stored,
      known: knownNow(stores, stored.known),
      // Old keys this device is done with are never fetched again (audit 5 A-1).
      previous: stored.previous.filter((key) => !stored.retired.includes(key)),
    };
    const { token, key } = await syncKeys(fromBase64Url(secret));
    const now = Date.now();

    // 1. This device. What was edited here counts as noted only once what this
    // device knew is saved with it (step 5 or 6): if the app is put away
    // before that, the edit is noted then (audit 6 S22).
    const { before, local, changed: localChanged } = observeAll(state, now);
    knownSaved = false;
    const upgraded = state.known !== stored.known;
    try {
      return await mergeRound(state, secret, { token, key }, now, {
        before,
        local,
        localChanged,
        upgraded,
      });
    } catch (error) {
      // The round failed before what this device knew said the merge (no
      // connection, say): what was edited here is noted now, with this
      // time, instead of at the next round that reaches the copy, which
      // may be weeks away (audit 5 E-1).
      if (!knownSaved && localChanged && !(error instanceof StoppedError)) rememberEdits(now);
      throw error;
    }
  }

  /** Steps 2 to 7 of a round (see round()), given what step 1 saw of this device. */
  async function mergeRound(
    state: DeviceState,
    secret: string,
    { token, key }: Keys,
    now: number,
    device: {
      before: Record<string, string>;
      local: Stores;
      localChanged: boolean;
      /** What this device knew was brought to a new data version (knownNow). */
      upgraded: boolean;
    },
  ): Promise<boolean> {
    const { before, local, localChanged, upgraded } = device;
    // 2. The online copy, and any old copies to bring along. Files saved here
    // go online now, before the data that uses them, so other devices find
    // them as soon as it arrives; only now, so a device that may not sync the
    // copy (still on a deleted one) never puts its files there (audit 4 E-1).
    const remote = await fetchCopy(state, token, key);
    if (files) await fileSync.uploadFiles(files);
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
    /** The merge before old deletion markers are dropped from it (see step 5). */
    const unpruned: Stores = {};
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
          const both = keepBoth(
            base,
            result,
            theirs,
            synced.conflictCopy,
            now,
            synced.keepSame ?? false,
          );
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
      unpruned[synced.store.key] = result;
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
    /** What this device knew was saved as just before the upload (none without one). */
    let pending: Record<string, Known> | null = null;
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
      // The upload takes deletions older than the markers to the copy by
      // leaving the items out. Until it has, the markers of those made here
      // stay in what this device knew: if the upload fails, or another
      // device wrote first, the next round still knows they were deleted
      // here (audit 6 S5).
      const unsent: Record<string, Known> = {};
      for (const [storeKey, snapshot] of Object.entries(unpruned)) {
        unsent[storeKey] = knownFrom(pruneUnsent(snapshot, seenOnline?.stores[storeKey], now));
      }
      if (!updateState(secret, { known: unsent, dirty: true, base: seenOnline })) {
        throw stateNotSaved();
      }
      pending = unsent;
      // What this device knew says the merge now, with every edit made here
      // until step 4 checked: nothing to undo, and nothing to note if the
      // upload fails (round()).
      changed.length = 0;
      knownSaved = true;
      edited = false;
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

    // 6. Remember. The copy online is now the merge. An edit made while the
    // upload was on its way, and noted as the app was put away (here or in
    // another tab: rememberEdits), keeps that note and its time: the next
    // round uploads it, maybe only when the app is opened again, days later.
    // Before, this step saved over the note, and that round dated the edit
    // (audit 6 S22).
    const noted = pending !== null && canonical(loadState()?.known) !== canonical(pending);
    const base = online ? { epoch: online.epoch, stores: knowns } : null;
    const saved = {
      remote: online,
      ...(noted ? {} : { known: knowns, dirty: false }),
      base,
      last: now,
      ...answered(),
    };
    if (!updateState(secret, saved)) throw stateNotSaved();
    knownSaved = true;
    // Without an upload, nothing could be edited here since step 4 checked.
    if (pending === null) edited = false;

    // 7. The old copies are in the new one now (and their files, re-sealed with
    // the new key, and the app's linked data): delete them, so devices still
    // using them stop. Old copies another device moved first get their linked
    // data moved too: that device may have been the lost one. Either way this
    // device is done with those keys, for good (audit 5 A-1).
    if (state.previous.length > 0) {
      for (const old of moving) {
        if (files) await fileSync.moveFiles(files, old, { token, key });
        if (linked) await linked.move(old.secret, fromBase64Url(secret));
        const response = await api('/copy?moved', { method: 'DELETE' }, old.token);
        if (!response.ok) throw failed(response);
      }
      if (linked) {
        for (const old of movedAway) await linked.move(old.secret, fromBase64Url(secret));
      }
      const done = [...moving, ...movedAway].map((old) => old.encoded);
      const retired = withRetired(state.retired, done);
      if (!updateState(secret, { previous: stillWaiting, waiting, retired })) {
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

  /** Since when this tab has been waiting for another one to finish syncing. */
  let waitingSince: number | null = null;

  /**
   * Runs `task` while no other tab of this app syncs (navigator.locks, in
   * Safari from 15.4). Two tabs syncing at once each noted the same change,
   * at a moment of its own, and keeping both versions of the same change
   * (keepSame) then took it for two (audit 4 F2-3). False, without running
   * it, while another tab syncs, until it has for TAB_PATIENCE_MS: then it
   * runs anyway. Without locks, it runs, as before.
   */
  async function inTurn(task: () => Promise<void>): Promise<boolean> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (locks) {
      let entered = false;
      try {
        await locks.request(`shkriuss-sync:${options.app}`, { ifAvailable: true }, async (lock) => {
          if (lock === null) return;
          entered = true;
          await task();
        });
      } catch (error) {
        if (entered) throw error;
        // Locks refused (in a sandboxed page, say): as without them.
        await task();
        return true;
      }
      if (entered) {
        waitingSince = null;
        return true;
      }
      waitingSince ??= Date.now();
      if (Date.now() - waitingSince < TAB_PATIENCE_MS) return false;
    }
    waitingSince = null;
    await task();
    return true;
  }

  async function run(): Promise<void> {
    if (!isSyncOn()) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    // Another tab is syncing: this one tries again in a moment.
    if (!(await inTurn(rounds))) {
      busy = false;
      schedule(TAB_RETRY_MS);
    }
  }

  /** Merges with the copy online, round after round, until they agree. */
  async function rounds(): Promise<void> {
    keptBoth = 0;
    const stopsBefore = stops;
    const secretBefore = loadState()?.secret ?? null;
    emit();
    let event: SyncEvent | undefined;
    try {
      fileSync.start();
      let done = false;
      for (let attempt = 0; attempt < MAX_ROUNDS && !done; attempt += 1) done = await round();
      if (done && files) done = await fileSync.tidyFiles(files);
      if (!done) again = true;
      problem = fileSync.noRoom() ? 'files-full' : null;
      event = keptBoth > 0 ? 'kept-both' : 'synced';
    } catch (error) {
      const state = loadState();
      // Stopped: sync was turned off meanwhile, which says so itself. Or the
      // online copy was deleted in this tab meanwhile, and the sync found it
      // gone: that isn't "deleted on another device". Or sync was turned on
      // again with another key meanwhile (in another tab, say): what this
      // sync found is about the copy before, and mustn't turn that one off.
      const replaced = Boolean(state?.secret) && state?.secret !== secretBefore;
      const stale = error instanceof StoppedError || stops !== stopsBefore || replaced;
      problem = stale ? null : problemOf(error);
      if (!stale && state && isGone(error) && !switchOff(state)) problem = stateProblem();
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

  /**
   * The code for connecting to the account, loaded only when it's needed
   * (below, and in connect()): nearly every page never needs it (audit 5 J-2).
   */
  const connectCode = () => import('./connect.ts');

  /** Coming back from the hub with "#connect=…". */
  async function finishConnect(): Promise<void> {
    const result = parseConnectResult(location.hash);
    if (!result) return;
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    let pending: Pending | null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as Pending | null;
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
      const { openConnection } = await connectCode();
      const connection = await openConnection(options.app, pending, result);
      const turnedOn = timeOf(pending.turnedOn) ?? Date.now();
      if (!saveConnection(connection, turnedOn)) throw new SyncError(stateProblem());
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
   * app syncs with can make the proof, and only for the day (audit 5 A-5),
   * so a link from anyone else can't. Any website can open such a link: with
   * sync already off it changes nothing, and says nothing (audit 5 C-4).
   */
  async function turnOffFromHub(proof: string): Promise<void> {
    const state = loadState();
    if (!state?.secret) return;
    let proven = false;
    try {
      const { isTurnOffProof } = await connectCode();
      proven = await isTurnOffProof(fromBase64Url(state.secret), proof);
    } catch {
      // The code that checks the proof couldn't be loaded (no connection,
      // after an update): sync stays on, as for a proof that isn't this account's.
    }
    if (!proven) {
      emit('kept-on');
      schedule(0);
      return;
    }
    client.turnOff();
  }

  /**
   * Sync off on this device, keeping what it knew (for turning it on again
   * later) if the browser has room for that; otherwise the key alone goes,
   * and a later "Turn on sync" starts like the first time. Before, a "Turn
   * off" the browser had no room to save left sync on, while the page said
   * it was off (audit 5 E-2). False if not even the key could go.
   */
  function switchOff(state: DeviceState, retired = state.retired): boolean {
    const off = saveState({ ...offState(state), retired }) || saveState(null);
    forgetFiles();
    return off;
  }

  const client: SyncClient = {
    status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    changed() {
      const state = loadState();
      if (state?.secret) {
        edited = true;
        schedule(CHANGE_DELAY_MS);
      } else if (state) rememberWhileOff(state);
    },
    syncNow: () => run(),
    async connect() {
      const response = await api('/hub');
      if (!response.ok) throw new SyncError('server');
      const { origin, now } = (await response.json()) as { origin: string; now?: unknown };
      // Pressed now, by the server's clock (see DeviceState.connected).
      const turnedOn = timeOf(now) ?? serverClock() ?? Date.now();
      const { connectUrl, newConnectRequest } = await connectCode();
      const { request, pending } = await newConnectRequest(options.app, location.origin);
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, turnedOn } as Pending));
      } catch (error) {
        throw new SyncError(isStorageFull(error) ? 'full' : 'storage');
      }
      location.assign(connectUrl(origin, request));
    },
    turnOff() {
      const state = loadState();
      if (!state?.secret) return true;
      stops += 1;
      const off = switchOff(state);
      problem = off ? null : stateProblem();
      emit(off ? 'turned-off' : undefined);
      return off;
    },
    async deleteOnline() {
      const state = loadState();
      if (!state?.secret) return;
      // Copies of replaced keys not moved here yet go too, with their linked
      // data: the lost device that has the old key could still read them.
      // They're marked as moved, so the old key can't start them again, and
      // this device is done with those keys (audit 5 A-1).
      for (const encoded of state.previous) {
        const old = fromBase64Url(encoded);
        const keys = await syncKeys(old);
        if (linked) await linked.delete(old, await onlineItems(keys));
        const response = await api('/copy?moved', { method: 'DELETE' }, keys.token);
        // 507: nothing was online for it, and no room for the note just now.
        if (!response.ok && response.status !== 507) throw failed(response);
      }
      const secret = fromBase64Url(state.secret);
      const keys = await syncKeys(secret);
      if (linked) await linked.delete(secret, await onlineItems(keys));
      const { token } = keys;
      const response = await api('/copy', { method: 'DELETE' }, token);
      if (!response.ok) throw failed(response);
      // Only once it's deleted: a sync under way when deleting fails still
      // says what went wrong with it.
      stops += 1;
      const off = switchOff(state, withRetired(state.retired, state.previous));
      problem = off ? null : stateProblem();
      emit(off ? 'deleted-online' : undefined);
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
   * What this device knew, with the items edited or deleted here since,
   * noted at `now`: the time they were made, as far as this device knows.
   * Null if nothing changed. (A store never synced is left alone: its first
   * sync counts its items as older than what's online.)
   */
  function editsSince(state: DeviceState, now: number): Record<string, Known> | null {
    const known = { ...state.known };
    let changed = false;
    for (const synced of stores) {
      const { key } = synced.store;
      const before = known[key];
      if (!before || unsyncable(synced, before)) continue;
      const seen = observe(before, synced.items(synced.store.load()), synced.store.version, now);
      if (!seen.changed) continue;
      // Not online yet: a deletion made here keeps its marker until a sync
      // takes it there, even after 180 days (audit 6 S5).
      known[key] = knownFrom(pruneUnsent(seen.snapshot, state.base?.stores[key], now));
      changed = true;
    }
    return changed ? known : null;
  }

  /**
   * Sync is off but was on before: keep track of when items are edited or
   * deleted here, so turning it on again merges them properly.
   */
  function rememberWhileOff(state: DeviceState): void {
    const known = editsSince(state, Date.now());
    if (known) saveState({ ...state, known });
  }

  /**
   * Sync is on, but no round has noted an edit made here yet (none reached
   * the copy, or the page is being put away before the next one, or while
   * one waits for the server): it's noted now, with its time, as `dirty`
   * for the next round to upload. An edit
   * made on day 1 was otherwise dated by the first round that reached the
   * copy, day 21 say, and won over a newer edit made elsewhere on day 10
   * (audit 5 E-1). Stopped meanwhile, or data this version can't read: the
   * next round says so.
   */
  function rememberEdits(now = Date.now()): void {
    const state = loadState();
    if (!state?.secret) return;
    try {
      const known = editsSince(state, now);
      if (known) updateState(state.secret, { known, dirty: true });
      edited = false;
    } catch {
      // Nothing noted: the next round notes it, or says what's wrong.
    }
  }

  // After an update that changed a data version: bring what this device knew
  // to the new version now, while the data is still saved in the old one (the
  // app's next save changes that), even if sync is off or there's no connection.
  const start = loadState();
  if (start) {
    const known = knownNow(stores, start.known);
    if (known !== start.known) saveState({ ...start, known });
  }

  // Keep up with other devices while the app is open. Put away (the phone
  // locked, another app): an edit no round has noted yet is noted now, with
  // its time, as the page may not run again before it's closed (audit 5 E-1),
  // also while a sync waits for the server (audit 6 S22).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(0);
    else if (edited) rememberEdits();
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
