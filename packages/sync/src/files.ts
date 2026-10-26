/**
 * Files that go with an app's data, like photos (docs/adr/0014), for
 * ./client.ts: after each sync, files saved here go online and files deleted
 * here are deleted online, each sealed on its own.
 */
import { fromBase64Url, openBytes, sealBytes } from '@shkriuss/crypto';
import { loadFiles, loadState, updateFiles } from './device.ts';
import { failed, goneError, isGone, PausedError, SyncError, api, type Keys } from './requests.ts';
import { fileLabel, syncKeys } from './snapshot.ts';
import { FILE_ID, MAX_FILE_BYTES, type FileList } from './validate.ts';

/** Check every file against the online list this often (and once sync is turned on). */
const CHECK_FILES_MS = 24 * 60 * 60 * 1000;
/**
 * The daily check leaves files this new alone: they go online before the
 * data that uses them, so another device may not have sent that data yet.
 */
const NEW_FILE_MS = 24 * 60 * 60 * 1000;
/** After the server says "too many changes", leave files alone this long. */
const FILES_PAUSE_MS = 10 * 60 * 1000;

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

/** Keeping one app's files online. */
export function createFileSync(app: string) {
  /** Set when a file had no room online since start(). */
  let noRoom = false;

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
    return openBytes(key, sealed, fileLabel(app, id)).catch(() => null);
  }

  /** Seals a file and puts it online (one too big to sync just stays here). */
  async function putFile({ token, key }: Keys, id: string, bytes: Uint8Array<ArrayBuffer>) {
    const sealed = await sealBytes(key, bytes, fileLabel(app, id));
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
      // Not synced since sync was turned on, and the copy was deleted: the
      // round decides whether to start a new one (audit 4 E-1). The files
      // stay queued, and the daily check after that round puts them up.
      if (isGone(error) && !work.state.remote) return;
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

  return {
    /** At the start of a run: no file has found no room yet. */
    start(): void {
      noRoom = false;
    },
    /** Whether a file had no room online since start(). */
    noRoom: (): boolean => noRoom,
    fetchFile,
    uploadFiles,
    tidyFiles,
    moveFiles,
  };
}
