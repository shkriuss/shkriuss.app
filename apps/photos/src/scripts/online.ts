/**
 * Photos' online library (docs/adr/0016-online-photo-library.md). Sync
 * through the shkriuss account (@shkriuss/sync) carries the library's id and
 * keys; @shkriuss/library talks to its server. After each sync, this:
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
  isLibraryRecord,
  libraryAccess,
  libraryApi,
  LibraryError,
  libraryRecord,
  linkedLibrary,
  type LibraryApi,
  type LibraryProblem,
  type LibraryRecord,
} from '@shkriuss/library';
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore, type SyncClient } from '@shkriuss/sync';
import {
  applyChanges,
  waitingToGoUp,
  type OnlineProblem,
  type OnlineState,
} from '../lib/online.ts';
import { detailsOf, PARTS, type Photo } from '../lib/photos.ts';
import {
  deletePhotos,
  getFiles,
  keepThumb,
  loadProgress,
  moveFiles,
  removeOriginals,
  saveDetails,
  saveProgress,
  type OnlineProgress,
} from './library.ts';

/** Photos put online in one round, before looking for changes again. */
const UPLOADS_PER_ROUND = 10;
/** Thumbnails asked for within this long go in one request. */
const THUMBS_DELAY_MS = 50;

/** The library's record, kept in the synced copy (it moves with a new account key). */
interface Records {
  items: LibraryRecord[];
}
const records = createStore<Records>({
  key: 'library',
  version: 1,
  fallback: () => ({ items: [] }),
  validate: (value): value is Records =>
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Records).items) &&
    (value as Records).items.every(isLibraryRecord),
});
const currentRecord = () => records.load().items.find((item) => item.id === 'library');

/** The page's photos, and how to show changes to them (already saved on the device). */
export interface PhotoList {
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
  /** Photos are being deleted here: those online are deleted there too. */
  removed(photos: readonly Photo[]): Promise<void>;
  unlock(code: string): Promise<UnlockResult>;
  /** A thumbnail of a photo that's only online: downloaded and kept. */
  thumb(photo: Photo): Promise<string | null>;
  /** The screen-sized copy or the original, downloaded (null if it can't be). */
  download(photo: Photo, part: 'view' | 'original'): Promise<Blob | null>;
  /** Removes originals (and screen-sized copies) that are online from this device. */
  freeUpSpace(photos: readonly Photo[]): Promise<void>;
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

  const emit = () => {
    for (const listener of listeners) listener();
  };

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

  async function connect(): Promise<LibraryApi | null> {
    const secret = sync.secret();
    const record = currentRecord();
    return secret && record ? libraryApi(await libraryAccess(secret, record)) : null;
  }

  /** The library's record: made by the first device, gaining each new account key. */
  async function ensureRecord(): Promise<boolean> {
    const secret = sync.secret();
    if (!secret) return false;
    const existing = currentRecord();
    const next = await libraryRecord(secret, existing);
    if (next === existing) return true;
    const others = records.load().items.filter((item) => item.id !== 'library');
    if (!records.save({ items: [...others, next] })) {
      problem = 'storage';
      return false;
    }
    sync.changed();
    return true;
  }

  /** What was online is gone (the library was deleted): photos only there go too. */
  async function forgetOnline(): Promise<void> {
    const all = list.all();
    const gone = all.filter((photo) => !photo.here).map((photo) => photo.id);
    const stay = all.filter((photo) => photo.here && photo.online);
    const offline = stay.map((photo) => ({ ...photo, online: null }));
    if (offline.length > 0) await saveDetails(offline);
    if (gone.length > 0) await deletePhotos(gone);
    await updateProgress((current) => fresh(current?.library ?? ''));
    list.changed({ save: offline, remove: gone });
  }

  /** Sync is off here: photos only online can't be seen until it's on again. */
  async function hideOnlyOnline(): Promise<void> {
    const gone = list
      .all()
      .filter((photo) => !photo.here)
      .map((photo) => photo.id);
    if (gone.length > 0) await deletePhotos(gone);
    // Start again from the beginning next time, to find them again.
    await updateProgress((current) => ({
      ...fresh(current?.library ?? ''),
      removals: current?.removals ?? [],
    }));
    list.changed({ remove: gone });
  }

  /** Brings in changes from other devices, a page at a time. */
  async function pull(api: LibraryApi): Promise<void> {
    const library = currentRecord()?.library ?? '';
    for (;;) {
      const before = await loadProgress();
      const progress =
        before && before.library === library ? before : fresh(library, before?.removals);
      const page = await api.changes(progress.since);
      checked = true;
      unlocked = page.unlocked;
      usage = page.usage;
      if (page.wiping) problem = 'wiping';
      if (progress.epoch !== null && page.epoch !== progress.epoch) {
        // The library was deleted and started again: start again too.
        await forgetOnline();
        continue;
      }
      const applied = applyChanges(
        new Map(list.all().map((photo) => [photo.id, photo])),
        page.changes,
      );
      for (const { from, to } of applied.moves) await moveFiles(from, to);
      if (applied.save.length > 0) await saveDetails(applied.save);
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
      ...(current ?? fresh(currentRecord()?.library ?? '')),
      removals: (current?.removals ?? []).filter((id) => !sent.has(id)),
    }));
  }

  /** Puts a few photos from here online. */
  async function goUp(api: LibraryApi): Promise<void> {
    if (!unlocked || (retryAt !== null && Date.now() < retryAt)) return;
    retryAt = null;
    for (const photo of waitingToGoUp(list.all(), skip).slice(0, UPLOADS_PER_ROUND)) {
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
        const now = list.get(photo.id);
        if (!now) {
          // Deleted here while it was going up.
          await updateProgress((current) => ({
            ...(current ?? fresh(currentRecord()?.library ?? '')),
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
            ...(current ?? fresh(currentRecord()?.library ?? '')),
            since: 0,
          }));
          again = true;
        } else if (error.problem === 'deleted') {
          // Deleted on another device meanwhile.
          await deletePhotos([photo.id]);
          list.changed({ remove: [photo.id] });
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
      if (!(await ensureRecord())) return;
      const api = await connect();
      if (!api) return;
      problem = null;
      await pull(api);
      await sendRemovals(api);
      await goUp(api);
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
    linked: linkedLibrary(currentRecord),
  });

  sync.subscribe((status, event) => {
    // Only after a sync: the record from other devices (or an old key) is in by then.
    if (event === 'synced' || event === 'kept-both') schedule();
    if (event === 'deleted-online' || status.problem === 'deleted') void forgetOnline();
    else if (event === 'turned-off' || status.problem === 'moved') void hideOnlyOnline();
    if (!status.on) {
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

  return {
    sync,
    state: () => ({
      on: sync.status().on,
      checked,
      unlocked,
      usage,
      waiting: waitingToGoUp(list.all(), skip).length,
      tooBig: tooBig.size,
      problem,
      retryAt,
    }),
    subscribe(listener) {
      listeners.add(listener);
    },
    added() {
      if (sync.status().on) schedule();
    },
    async removed(photos) {
      const online = photos.filter((photo) => photo.online).map((photo) => photo.id);
      if (online.length === 0) return;
      await updateProgress((current) => ({
        ...(current ?? fresh(currentRecord()?.library ?? '')),
        removals: [...new Set([...(current?.removals ?? []), ...online])],
      }));
      if (sync.status().on) schedule();
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
    async freeUpSpace(photos) {
      await removeOriginals(photos);
      list.changed({ save: photos.map((photo) => ({ ...photo, here: false })) });
    },
  };
}
