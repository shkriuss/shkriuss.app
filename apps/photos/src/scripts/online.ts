/**
 * Photos' online library (docs/adr/0016-online-photo-library.md). Sync
 * through the shkriuss account (@shkriuss/sync) carries the libraries' ids
 * and keys; @shkriuss/library says which library to use, and talks to its
 * server. After each sync, this:
 *
 *   1. brings in changes from other devices (lib/online.ts),
 *   2. deletes online what was deleted here,
 *   3. puts photos from here online, a few at a time.
 *
 * Thumbnails of photos that are only online come down when they're shown,
 * several at once; the screen-sized copy when one is opened; the original
 * only to save it.
 */
import {
  libraryAccess,
  libraryApi,
  LibraryError,
  linkedLibrary,
  tidyRecords,
  usableRecord,
  useLibrary,
  type LibraryApi,
  type LibraryProblem,
  type LibraryRecord,
} from '@shkriuss/library';
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore, type SyncClient } from '@shkriuss/sync';
import {
  applyChanges,
  canFreeUp,
  freeable,
  onlyOnline,
  RECORDS,
  waitingToGoUp,
  type OnlineProblem,
  type OnlineState,
  type Records,
} from '../lib/online.ts';
import { detailsOf, PARTS, type Photo } from '../lib/photos.ts';
import {
  changedElsewhere,
  deletePhotos,
  getFiles,
  keepThumb,
  loadProgress,
  photosNow,
  removeOriginal,
  saveDetails,
  saveProgress,
  withOriginals,
  type OnlineProgress,
} from './library.ts';

/** Photos put online in one round, before looking for changes again. */
const UPLOADS_PER_ROUND = 10;
/** Thumbnails asked for within this long go in one request. */
const THUMBS_DELAY_MS = 50;

/** The libraries' records, kept in the synced copy (they move with a new account key). */
const records = createStore<Records>(RECORDS);
const allRecords = () => tidyRecords(records.load().items);

/** The page's photos, and how to show changes to them (already saved on the device). */
export interface PhotoList {
  /**
   * Resolves once the photos on this device are loaded. Until then all() has
   * none of them (with a big library, for seconds), and changes from the
   * online library mustn't be compared with that: every photo here would
   * look new from another device, and be saved as only online (audit 3 F3-8).
   */
  ready: Promise<void>;
  all(): readonly Photo[];
  get(id: string): Photo | undefined;
  changed(change: { save?: readonly Photo[]; remove?: readonly string[] }): void;
}

export type UnlockResult = 'ok' | 'wrong' | 'too-many' | 'not-set-up' | 'offline';

export interface Online {
  sync: SyncClient;
  /** Whether sync is on, and what the status line needs. */
  state(): OnlineState & { on: boolean };
  subscribe(listener: () => void): void;
  /** Photos were added here: they go up soon. */
  added(): void;
  /**
   * Sync is off: these photos (only online) go from this device until it's
   * on again, and where this device had got to in the library starts again
   * from the beginning, so they're found again then.
   */
  hideOnlyOnline(ids: readonly string[]): Promise<void>;
  /**
   * Photos are being deleted here. With `everywhere` (sync was on when the
   * person was asked), those online are deleted there too, now or once sync
   * is on again. Without it, only here: the online library keeps them, and
   * they show here again, as only online, once sync is on (audit 3 F3-1).
   */
  removed(photos: readonly Photo[], everywhere: boolean): Promise<void>;
  /**
   * Photos that removed() was told of couldn't be deleted here after all
   * (the page says so): they aren't deleted online either (audit 6 F3-4).
   */
  kept(ids: readonly string[]): Promise<void>;
  unlock(code: string): Promise<UnlockResult>;
  /** A thumbnail of a photo that's only online: downloaded and kept. */
  thumb(photo: Photo): Promise<string | null>;
  /** The screen-sized copy or the original, downloaded (null if it can't be). */
  download(photo: Photo, part: 'view' | 'original'): Promise<Blob | null>;
  /**
   * Removes originals (and screen-sized copies) that are online from this
   * device, once the library has just said they're still there. Returns the
   * bytes freed; throws if it couldn't free any.
   */
  freeUpSpace(photos: readonly Photo[]): Promise<number>;
}

const isStorageError = (error: unknown) => error instanceof DOMException;

/** What the status line says about a failed round ("locked" shows the storage code form instead). */
function asProblem(problem: LibraryProblem): OnlineProblem | null {
  switch (problem) {
    case 'locked':
      return null;
    case 'wrong-code':
    case 'too-many-tries':
    case 'deleted':
    case 'unproven-deletion':
    case 'exists':
    case 'too-big':
      return 'server';
    default:
      return problem;
  }
}

export function startOnline(list: PhotoList): Online {
  const listeners = new Set<() => void>();
  let checked = false;
  let unlocked = false;
  let usage: OnlineState['usage'] = null;
  let problem: OnlineProblem | null = null;
  let retryAt: number | null = null;
  /** Photos too big to go online, and others not to try again until Photos opens again. */
  const tooBig = new Set<string>();
  const skip = new Set<string>();
  let running = false;
  let again = false;
  let timer: number | undefined;
  /**
   * A sync with the account finished since Photos opened (or connected): a
   * library is only started, or another one used, after one.
   */
  let synced = false;
  /** The library in use (its id). */
  let inUse = '';
  /**
   * The library this device used was taken by a device with an old account
   * key: the status line says so until Photos closes.
   */
  let taken = false;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  /** Rounds and "Free up space" take turns, so neither sees the photos half changed. */
  let turn: Promise<unknown> = Promise.resolve();
  function inTurn<T>(work: () => Promise<T>): Promise<T> {
    const run = turn.then(work);
    turn = run.catch(() => undefined);
    return run;
  }

  /** Changes to how far this device has got, one at a time, so none is lost. */
  let progressLock: Promise<unknown> = Promise.resolve();
  function updateProgress(
    change: (current: OnlineProgress | undefined) => Omit<OnlineProgress, 'id'>,
  ): Promise<Omit<OnlineProgress, 'id'>> {
    const run = progressLock.then(async () => {
      const next = change(await loadProgress());
      await saveProgress(next);
      return next;
    });
    progressLock = run.catch(() => undefined);
    return run;
  }
  const fresh = (library: string, removals: string[] = []) => ({
    library,
    epoch: null,
    since: 0,
    removals,
  });

  /** Talks to `record`'s library, or else to the one to use now, if there's one. */
  async function connect(record?: LibraryRecord): Promise<LibraryApi | null> {
    const secret = sync.secret();
    const found = record ?? (secret ? await usableRecord(secret, allRecords()) : undefined);
    return secret && found ? libraryApi(await libraryAccess(secret, found)) : null;
  }

  /**
   * The library to use: the oldest this account can (useLibrary). The first
   * device makes it, once a sync has finished and found none; records saved
   * by older versions are tidied.
   */
  async function ensureRecord(): Promise<LibraryRecord | undefined> {
    const secret = sync.secret();
    if (!secret) return undefined;
    const saved = records.load().items;
    const chosen = await useLibrary(secret, saved, synced);
    if (chosen.records !== saved) {
      if (!records.save({ items: [...chosen.records] })) {
        problem = 'storage';
        return undefined;
      }
      sync.changed();
    }
    return chosen.record;
  }

  /**
   * What was online is gone (the library was deleted), or in another library
   * now: photos only there go too, and those here go up again. Every photo
   * on this device, not only those in this tab's list, which may be older
   * (audit 6 F3-1). A photo is here when its original is: one marked as
   * here without it (an older version's "Free up space" stopped half-way)
   * was only online too, so it isn't kept as here (audit F3-1), and one
   * whose original is here stays, whatever its mark says (audit 6 F3-1).
   */
  async function forgetOnline(library?: string, removals: string[] = []): Promise<void> {
    const all = await photosNow();
    const originals = await withOriginals();
    const gone = all.filter((photo) => !originals.has(photo.id)).map((photo) => photo.id);
    const offline = all
      .filter((photo) => originals.has(photo.id) && (photo.online || !photo.here))
      .map((photo) => ({ ...photo, online: null, here: true }));
    if (offline.length > 0) await saveDetails(offline);
    if (gone.length > 0) await deletePhotos(gone);
    await updateProgress((current) => fresh(library ?? current?.library ?? '', removals));
    list.changed({ save: offline, remove: gone });
  }

  /**
   * Sync is off here: photos only online can't be seen until it's on again.
   * They go from the list at once, and from the device in turn, after a
   * round under way (which stops at its next step), so that round can't
   * write back where it had got to (audit F3-2). Never one whose original
   * is here: another tab may have put it back since this tab's list was
   * loaded (audit 6 F3-1).
   */
  function hideOnlyOnline(
    ids: readonly string[] = onlyOnline(list.all()).map((photo) => photo.id),
  ): Promise<void> {
    list.changed({ remove: ids });
    return inTurn(async () => {
      const now = await photosNow();
      const originals = await withOriginals();
      const gone = [...new Set([...ids, ...onlyOnline(now).map((photo) => photo.id)])].filter(
        (id) => !originals.has(id),
      );
      // Marked as only online with the original here (as this could happen
      // before): marked as here again. Taken from the list but here: back in it.
      const mended = now
        .filter((photo) => !photo.here && originals.has(photo.id))
        .map((photo) => ({ ...photo, here: true }));
      const asked = new Set(ids);
      const back = [
        ...mended,
        ...now.filter((photo) => photo.here && asked.has(photo.id) && originals.has(photo.id)),
      ];
      if (mended.length > 0) await saveDetails(mended);
      if (gone.length > 0) await deletePhotos(gone);
      // Start again from the beginning next time, to find them again.
      await updateProgress((current) => ({
        ...fresh(current?.library ?? ''),
        removals: current?.removals ?? [],
      }));
      list.changed({ save: back, remove: gone });
    });
  }

  /** Sync's key now, as text to compare, or null while sync is off. */
  const keyNow = (): string | null => sync.secret()?.join() ?? null;

  /**
   * A check that sync is still on, with the key it has now. A round stops at
   * its next step once it isn't: nothing more comes in, is noted or goes up
   * after sync is turned off here, or on with another key (audit F3-2).
   */
  function stillOnCheck(): () => boolean {
    const key = keyNow();
    return () => key !== null && keyNow() === key;
  }

  /** Brings in changes from other devices, a page at a time. */
  async function pull(api: LibraryApi, library: string, stillOn: () => boolean): Promise<void> {
    for (;;) {
      if (!stillOn()) return;
      const before = await loadProgress();
      if (before && before.library !== library) {
        // Another library now (another account's, an older one of this
        // account's, or a new one: the old one was taken): photos here are
        // found in it, or go up to it again.
        if (allRecords().some((record) => record.library === before.library && record.taken)) {
          taken = true;
        }
        await forgetOnline(library, before.removals);
        continue;
      }
      const progress = before ?? fresh(library);
      const page = await api.changes(progress.since);
      if (!stillOn()) return;
      checked = true;
      unlocked = page.unlocked;
      usage = page.usage;
      if (page.wiping) problem = 'wiping';
      if (progress.epoch !== null && page.epoch !== progress.epoch) {
        // The library was deleted and started again: start again too.
        await forgetOnline();
        continue;
      }
      // Compared with what's on this device now. That's this tab's list,
      // unless another tab changed the photos since it was loaded: then a
      // photo missing from it looked new from another device, and was saved
      // as only online over the real one (audit 6 F3-1), so they're read
      // from the database instead (not every time: with a big library, that
      // takes a while, for each page of changes).
      const here =
        page.changes.length === 0 ? [] : changedElsewhere() ? await photosNow() : list.all();
      const applied = applyChanges(
        new Map(here.map((photo) => [photo.id, photo])),
        page.changes,
        // Deleted here, and not online yet (say sync was turned off before
        // it got there): they don't come back (audit 3 F3-1).
        new Set(progress.removals),
      );
      // The files of a photo here that's the same as one online go to its
      // id with the details, in one step (audit 5 E-4).
      if (applied.save.length > 0 || applied.moves.length > 0) {
        await saveDetails(applied.save, applied.moves);
      }
      if (applied.remove.length > 0) await deletePhotos(applied.remove);
      await updateProgress((current) => ({
        library,
        epoch: page.epoch,
        since: page.last,
        removals: [...new Set([...(current?.removals ?? []), ...applied.duplicates])],
      }));
      list.changed({ save: applied.save, remove: applied.remove });
      if (!page.more) return;
    }
  }

  /** Deletes online what was deleted here. */
  async function sendRemovals(api: LibraryApi): Promise<void> {
    const removals = (await loadProgress())?.removals ?? [];
    if (removals.length === 0) return;
    await api.remove(removals);
    const sent = new Set(removals);
    await updateProgress((current) => ({
      ...(current ?? fresh(inUse)),
      removals: (current?.removals ?? []).filter((id) => !sent.has(id)),
    }));
  }

  /** Puts a few photos from here online. */
  async function goUp(api: LibraryApi, stillOn: () => boolean): Promise<void> {
    if (!unlocked || (retryAt !== null && Date.now() < retryAt)) return;
    retryAt = null;
    for (const photo of waitingToGoUp(list.all(), skip).slice(0, UPLOADS_PER_ROUND)) {
      if (!stillOn()) return;
      const found = await getFiles(photo.id);
      if (!found?.original) {
        skip.add(photo.id);
        continue;
      }
      try {
        const done = await api.upload(photo.id, detailsOf(photo), [
          found.thumb,
          found.view,
          found.original,
        ]);
        // Sync turned off meanwhile, maybe by "Delete the online copy" in
        // another tab, which has already marked this device's photos as not
        // online: not marked as online now. If it's still in the library, a
        // later look at the library's changes finds it there (audit 6 F3-1).
        if (!stillOn()) return;
        const now = list.get(photo.id);
        if (!now) {
          // Deleted here while it was going up.
          await updateProgress((current) => ({
            ...(current ?? fresh(inUse)),
            removals: [...(current?.removals ?? []), photo.id],
          }));
          again = true;
          continue;
        }
        const saved = { ...now, online: { key: done.key, parts: done.parts } };
        await saveDetails([saved]);
        list.changed({ save: [saved] });
        // Counted here until the next look at the library says it too.
        const size = done.parts.reduce((sum, part) => sum + part, 0);
        usage = { items: (usage?.items ?? 0) + 1, bytes: (usage?.bytes ?? 0) + size };
        emit();
      } catch (error) {
        if (!(error instanceof LibraryError)) throw error;
        if (error.problem === 'too-big') {
          tooBig.add(photo.id);
          skip.add(photo.id);
        } else if (error.problem === 'exists') {
          // Online already (an answer that got lost): the list says where, from the start.
          skip.add(photo.id);
          await updateProgress((current) => ({
            ...(current ?? fresh(inUse)),
            since: 0,
          }));
          again = true;
        } else if (error.problem === 'deleted') {
          // Deleted on another device meanwhile.
          await deletePhotos([photo.id]);
          list.changed({ remove: [photo.id] });
        } else if (error.problem === 'unproven-deletion') {
          // The server says so, but no device of this account deleted it: it stays here.
          skip.add(photo.id);
        } else {
          if (error.problem === 'locked') unlocked = false;
          if (error.problem === 'daily-limit') retryAt = error.retryAt;
          throw error;
        }
      }
    }
    if (waitingToGoUp(list.all(), skip).length > 0) again = true;
  }

  async function round(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await list.ready;
      await inTurn(async () => {
        const stillOn = stillOnCheck();
        const record = await ensureRecord();
        // Another library only once a sync has finished: until then, the records may be half moved.
        const api = record && (synced || record.library === inUse) ? await connect(record) : null;
        if (!record || !api) {
          // No library to use yet: a check of another one doesn't count.
          checked = false;
          return;
        }
        inUse = record.library;
        problem = null;
        await pull(api, record.library, stillOn);
        if (!stillOn()) return;
        await sendRemovals(api);
        await goUp(api, stillOn);
      });
    } catch (error) {
      if (error instanceof LibraryError) problem = asProblem(error.problem);
      else problem = isStorageError(error) ? 'storage' : 'server';
    } finally {
      running = false;
      emit();
      if (again) {
        again = false;
        schedule(problem ? 60_000 : 0);
      }
    }
  }

  function schedule(delay = 0): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void round(), delay);
  }

  const sync = createSync({
    app: 'photos',
    stores: [
      syncedStore({
        store: records,
        items: (value) => value.items,
        withItems: (value, items) => ({ ...value, items }),
      }),
    ],
    onChange: () => schedule(),
    linked: linkedLibrary(allRecords, (items) => {
      if (!records.save({ items: [...items] })) return false;
      sync.changed();
      return true;
    }),
  });

  sync.subscribe((status, event) => {
    // Only after a sync: the records from other devices (or an old key) are in by then.
    if (event === 'synced' || event === 'kept-both') {
      synced = true;
      schedule();
    }
    // Connected again, maybe to another account: what this device knew is from before.
    if (event === 'connected') {
      synced = false;
      checked = false;
    }
    // In turn, after a round under way (audit F3-2), and once the photos here
    // are loaded (audit 3 F3-8). If one fails, what's left is tidied when
    // Photos opens again (photos.ts reload) or uses a library.
    if (event === 'deleted-online' || status.problem === 'deleted') {
      list.ready.then(() => inTurn(() => forgetOnline())).catch(() => undefined);
    } else if (event === 'turned-off' || status.problem === 'moved') {
      list.ready.then(() => hideOnlyOnline()).catch(() => undefined);
    }
    if (!status.on) {
      synced = false;
      checked = false;
      problem = null;
    }
    emit();
  });

  // ---------- Downloads ----------

  const thumbsWanted = new Map<string, { photo: Photo; done: ((url: string | null) => void)[] }>();
  let thumbsTimer: number | undefined;

  async function fetchThumbs(): Promise<void> {
    thumbsTimer = undefined;
    const batch = [...thumbsWanted.values()];
    thumbsWanted.clear();
    const finish = (id: string, url: string | null) => {
      for (const done of batch.find((wanted) => wanted.photo.id === id)?.done ?? []) done(url);
    };
    try {
      const api = await connect();
      const found = api
        ? await api.firstParts(
            batch.flatMap(({ photo }) =>
              photo.online
                ? [{ id: photo.id, key: photo.online.key, parts: photo.online.parts }]
                : [],
            ),
          )
        : new Map<string, Uint8Array<ArrayBuffer>>();
      for (const { photo } of batch) {
        const bytes = found.get(photo.id);
        finish(
          photo.id,
          bytes ? await keepThumb(photo.id, new Blob([bytes], { type: 'image/jpeg' })) : null,
        );
      }
    } catch {
      for (const { photo } of batch) finish(photo.id, null);
    }
  }

  const state = (): OnlineState & { on: boolean } => ({
    on: sync.status().on,
    checked,
    unlocked,
    usage,
    waiting: waitingToGoUp(list.all(), skip).length,
    tooBig: tooBig.size,
    problem,
    retryAt,
    taken,
  });

  return {
    sync,
    state,
    subscribe(listener) {
      listeners.add(listener);
    },
    added() {
      if (sync.status().on) schedule();
    },
    hideOnlyOnline,
    async removed(photos, everywhere) {
      const online = photos.filter((photo) => photo.online).map((photo) => photo.id);
      if (online.length === 0) return;
      if (!everywhere) {
        // Nothing to delete online. Where this device had got to in the
        // library starts again (as after turning sync off), so they're found
        // again once sync is on, even if it was turned on meanwhile.
        if (await loadProgress()) {
          await updateProgress((current) => ({ ...(current ?? fresh(inUse)), since: 0 }));
        }
        return;
      }
      await updateProgress((current) => ({
        ...(current ?? fresh(inUse)),
        removals: [...new Set([...(current?.removals ?? []), ...online])],
      }));
      if (sync.status().on) schedule();
    },
    async kept(ids) {
      const back = new Set(ids);
      await updateProgress((current) => ({
        ...(current ?? fresh(inUse)),
        removals: (current?.removals ?? []).filter((id) => !back.has(id)),
      }));
    },
    async unlock(code) {
      try {
        const api = await connect();
        if (!api) return 'offline';
        await api.unlock(code);
      } catch (error) {
        const failed = error instanceof LibraryError ? error.problem : 'offline';
        if (failed === 'wrong-code') return 'wrong';
        if (failed === 'too-many-tries') return 'too-many';
        if (failed === 'not-set-up') return 'not-set-up';
        return 'offline';
      }
      unlocked = true;
      problem = null;
      emit();
      schedule();
      return 'ok';
    },
    thumb(photo) {
      if (!photo.online || !sync.status().on) return Promise.resolve(null);
      return new Promise((done) => {
        const wanted = thumbsWanted.get(photo.id) ?? { photo, done: [] };
        wanted.done.push(done);
        thumbsWanted.set(photo.id, wanted);
        thumbsTimer ??= window.setTimeout(() => void fetchThumbs(), THUMBS_DELAY_MS);
      });
    },
    async download(photo, part) {
      if (!photo.online) return null;
      try {
        const api = await connect();
        const bytes = await api?.part(
          { id: photo.id, key: photo.online.key, parts: photo.online.parts },
          PARTS[part],
        );
        if (!bytes) return null;
        return new Blob([bytes], {
          type: part === 'view' ? 'image/jpeg' : photo.type || 'application/octet-stream',
        });
      } catch {
        return null;
      }
    },
    freeUpSpace: (photos) =>
      inTurn(async () => {
        // Only with the library that answered since Photos opened, asked again
        // now: an original goes only if its photo is still online.
        const stillOn = stillOnCheck();
        const secret = sync.secret();
        const record = secret ? await usableRecord(secret, allRecords()) : undefined;
        const api = record?.library === inUse && canFreeUp(state()) ? await connect(record) : null;
        if (!record || !api) throw new Error('The online library hasn’t answered.');
        try {
          await pull(api, record.library, stillOn);
        } finally {
          // The status line catches up, whatever happened.
          schedule();
        }
        // As saved on this device now, not as this tab's list has them:
        // another tab may have found them gone from the library since
        // (audit 6 F3-1). In the order asked (newest first); the list
        // catches up with them too.
        const saved = new Map((await photosNow()).map((photo) => [photo.id, photo]));
        const now = photos.flatMap((photo) => saved.get(photo.id) ?? []);
        list.changed({ save: now });
        const still = freeable(now).photos;
        if (!stillOn() || !canFreeUp(state()) || still.length === 0) {
          throw new Error('Nothing to free up.');
        }
        const freed: Photo[] = [];
        try {
          for (const photo of still) freed.push(await removeOriginal(photo));
        } finally {
          // Those freed before anything went wrong too.
          list.changed({ save: freed });
        }
        return freed.reduce((sum, photo) => sum + photo.size, 0);
      }),
  };
}
