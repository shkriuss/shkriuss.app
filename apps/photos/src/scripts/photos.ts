/**
 * Photos' page behaviour: connects pages/index.astro to the rules in
 * lib/photos.ts and the library on this device (library.ts). Picked photos
 * are read in a worker (process.ts), one at a time. With sync on, the
 * online library (online.ts) adds photos from other devices and takes this
 * device's online.
 */
import { focusProblem, showProblem } from '@shkriuss/ui/problem';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { setBusy } from '@shkriuss/ui/busy';
import { canFreeUp, freeable, onlineMessage, onlyOnline } from '../lib/online.ts';
import {
  addedMessage,
  byMonth,
  byNewest,
  countLabel,
  downloadName,
  formatBytes,
  formatLabel,
  librarySummary,
  localDateTime,
  monthLabel,
  PAGE_SIZE,
  photoAlt,
  takenLabel,
  type Added,
  type Photo,
} from '../lib/photos.ts';
import {
  changedElsewhere,
  deletePhotos,
  getFiles,
  loadLibrary,
  savePhoto,
  thumbUrl,
} from './library.ts';
import { startOnline } from './online.ts';
import { processFile } from './process.ts';
import { required } from '@shkriuss/ui/dom';

/** Offers a file to save, under this name. */
function saveFile(file: Blob, name: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Give the browser time to start the download before freeing the file.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Where a photo is, for the viewer's details. */
function whereLabel(photo: Photo): string {
  if (!photo.here) return 'Online (the original isn’t on this device)';
  return photo.online ? 'On this device and online' : 'On this device';
}

export function mountPhotos(root: Document): void {
  const announcer = required<HTMLElement>(root, '[data-announcer]');
  const addButton = required<HTMLButtonElement>(root, '[data-action="add-photos"]');
  const selectButton = required<HTMLButtonElement>(root, '[data-action="select"]');
  const photoInput = required<HTMLInputElement>(root, '[data-photo-input]');
  const libraryHeading = required<HTMLElement>(root, '[data-library-heading]');
  const summary = required<HTMLElement>(root, '[data-summary]');
  const adding = required<HTMLElement>(root, '[data-adding]');
  const empty = required<HTMLElement>(root, '[data-empty]');
  const selection = required<HTMLElement>(root, '[data-selection]');
  const selectedCount = required<HTMLElement>(root, '[data-selected-count]');
  const monthsList = required<HTMLElement>(root, '[data-months]');
  const showMoreButton = required<HTMLButtonElement>(root, '[data-action="show-more"]');
  const space = required<HTMLElement>(root, '[data-space]');
  const monthTemplate = required<HTMLTemplateElement>(root, '[data-month-template]');
  const tileTemplate = required<HTMLTemplateElement>(root, '[data-tile-template]');
  const viewer = required<HTMLDialogElement>(root, '[data-viewer]');
  const viewerTitle = required<HTMLElement>(viewer, '[data-viewer-title]');
  const viewerImage = required<HTMLImageElement>(viewer, '[data-viewer-image]');
  const viewerNone = required<HTMLElement>(viewer, '[data-viewer-none]');
  const viewerStatus = required<HTMLElement>(viewer, '[data-viewer-status]');
  const saveOriginalButton = required<HTMLButtonElement>(viewer, '[data-action="save-original"]');
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteTitle = required<HTMLElement>(deleteDialog, '[data-delete-title]');
  const deleteText = required<HTMLElement>(deleteDialog, '[data-delete-text]');
  const onlineOff = required<HTMLElement>(root, '[data-online-off]');
  const onlineSection = required<HTMLElement>(root, '[data-online]');
  const onlineStatus = required<HTMLElement>(root, '[data-online-status]');
  const unlockForm = required<HTMLFormElement>(root, '[data-unlock-form]');
  const storageCode = required<HTMLInputElement>(unlockForm, '[data-storage-code]');
  const unlockError = required<HTMLElement>(unlockForm, '[data-unlock-error]');
  const freeUp = required<HTMLElement>(root, '[data-free-up]');
  const freeUpDialog = required<HTMLDialogElement>(root, '[data-free-up-dialog]');
  const freeUpText = required<HTMLElement>(freeUpDialog, '[data-free-up-text]');

  /** Every photo, newest first. */
  let photos: Photo[] = [];
  let shown = PAGE_SIZE;
  let busy = false;
  /** While choosing photos: the chosen ones. */
  let choosing = false;
  const chosen = new Set<string>();
  /** The photo being looked at, and its URL while it's shown. */
  let viewing: { id: string; url: string | null } | null = null;
  /** What the delete dialog would delete. */
  let deleting: string[] = [];
  let renderTimer: number | undefined;

  const announce = (message: string): void => {
    announcer.textContent = message;
  };
  /**
   * Tells the person something that went wrong, where they are: in the photo
   * viewer while it's open (the page behind it can't be seen or heard), else
   * in the page's notice.
   */
  const problem = (message: string): void => {
    if (viewer.open) tellInViewer(message, true);
    else showProblem(message);
  };
  function tellInViewer(message: string, isProblem = false): void {
    viewerStatus.textContent = message;
    viewerStatus.toggleAttribute('data-problem', isProblem);
  }
  const find = (id: string | undefined) => photos.find((photo) => photo.id === id);

  // ---------- The online library ----------

  const online = startOnline({
    all: () => photos,
    get: find,
    changed({ save = [], remove = [] }) {
      if (save.length === 0 && remove.length === 0) return;
      const gone = new Set([...remove, ...save.map((photo) => photo.id)]);
      photos = [...photos.filter((photo) => !gone.has(photo.id)), ...save].sort(byNewest);
      for (const id of remove) chosen.delete(id);
      if (viewing && remove.includes(viewing.id) && viewer.open) viewer.close();
      // Many changes can come in a row: show them together.
      window.clearTimeout(renderTimer);
      renderTimer = window.setTimeout(render, 100);
    },
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), online.sync);
  online.subscribe(renderOnline);

  function renderOnline(): void {
    const state = online.state();
    onlineOff.hidden = state.on;
    onlineSection.hidden = !state.on;
    if (!state.on) return;
    onlineStatus.textContent = onlineMessage(state);
    unlockForm.hidden = !state.checked || state.unlocked || state.problem === 'not-set-up';
    // Only once the library has answered: this device's note that photos are online may be old.
    freeUp.hidden = !canFreeUp(state) || freeable(photos).photos.length === 0;
  }

  unlockForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = storageCode.value;
    if (!code) return;
    unlockError.textContent = '';
    storageCode.removeAttribute('aria-invalid');
    void online.unlock(code).then((result) => {
      if (result === 'ok') {
        storageCode.value = '';
        announce('Online storage is unlocked. Your photos are going online.');
        onlineStatus.focus();
        return;
      }
      unlockError.textContent = {
        wrong: 'That isn’t the storage code. Check it and try again.',
        'too-many': 'Too many wrong tries. Try again in an hour.',
        'not-set-up': 'Online storage isn’t set up yet.',
        offline: 'Couldn’t reach the online library. Check your connection and try again.',
      }[result];
      storageCode.setAttribute('aria-invalid', 'true');
      focusProblem(storageCode, unlockError.textContent ?? '');
    });
  });

  // ---------- Showing the library ----------

  /** A photo's thumbnail: from this device, or (only online) downloaded. */
  async function photoThumb(photo: Photo): Promise<string | null> {
    return (await thumbUrl(photo.id)) ?? (photo.here ? null : online.thumb(photo));
  }

  function renderTile(photo: Photo): HTMLLIElement {
    const fragment = tileTemplate.content.cloneNode(true) as DocumentFragment;
    const item = required<HTMLLIElement>(fragment, 'li');
    const button = required<HTMLButtonElement>(item, 'button');
    button.dataset['id'] = photo.id;
    button.ariaLabel = photoAlt(photo);
    if (choosing) button.ariaPressed = String(chosen.has(photo.id));
    const format = required<HTMLElement>(item, '[data-format]');
    format.textContent = formatLabel(photo);
    const image = required<HTMLImageElement>(item, '[data-thumb]');
    void photoThumb(photo).then((url) => {
      if (url) image.src = url;
      else {
        format.hidden = false;
        // The name includes the badge's words ("HEIC"), so people who use
        // voice control can say what they see (WCAG 2.5.3).
        button.ariaLabel = `${photoAlt(photo)}, ${format.textContent}`;
      }
    });
    return item;
  }

  function render(): void {
    const visible = photos.slice(0, shown);
    const totals = new Map<string, number>();
    for (const photo of photos) {
      const month = photo.taken.slice(0, 7);
      totals.set(month, (totals.get(month) ?? 0) + 1);
    }
    monthsList.replaceChildren(
      ...byMonth(visible).map(({ month, photos: list }) => {
        const fragment = monthTemplate.content.cloneNode(true) as DocumentFragment;
        const section = required<HTMLElement>(fragment, 'section');
        required<HTMLElement>(section, '[data-month]').textContent = monthLabel(month);
        required<HTMLElement>(section, '[data-count]').textContent = countLabel(
          totals.get(month) ?? list.length,
          'photo',
          'photos',
        );
        required<HTMLUListElement>(section, '[data-grid]').replaceChildren(...list.map(renderTile));
        return section;
      }),
    );
    empty.hidden = photos.length > 0;
    summary.hidden = photos.length === 0;
    summary.textContent = librarySummary(photos);
    showMoreButton.hidden = photos.length <= shown;
    selectButton.hidden = photos.length === 0 || choosing;
    renderChoosing();
    renderOnline();
    void renderSpace();
  }

  /** How much more this browser lets the app keep, if it says. */
  async function renderSpace(): Promise<void> {
    try {
      const { quota, usage } = await navigator.storage.estimate();
      space.textContent =
        quota === undefined || usage === undefined
          ? ''
          : `This browser can keep about ${formatBytes(Math.max(0, quota - usage))} more on this device.`;
    } catch {
      space.textContent = '';
    }
  }

  showMoreButton.addEventListener('click', () => {
    const first = photos[shown];
    shown += PAGE_SIZE;
    render();
    // Carry on from the first photo just shown.
    monthsList.querySelector<HTMLElement>(`[data-id="${first?.id ?? ''}"]`)?.focus();
  });

  // ---------- Adding photos ----------

  addButton.addEventListener('click', () => photoInput.click());

  photoInput.addEventListener('change', () => {
    const picked = [...(photoInput.files ?? [])];
    photoInput.value = '';
    if (picked.length > 0 && !busy) void addPhotos(picked);
  });

  /**
   * Reads and saves picked photos one at a time. The same photo isn't added
   * twice: picking one that's only online (after "Free up space") puts its
   * original back here, as it's the same file (the same SHA-256).
   */
  async function addPhotos(picked: readonly File[]): Promise<void> {
    busy = true;
    // Busy, not disabled, so focus stays on it while photos are added (audit G-7).
    setBusy(addButton, true);
    const result: Required<Added> = {
      added: 0,
      restored: 0,
      duplicates: 0,
      notPhotos: 0,
      failed: 0,
    };
    const byHash = new Map(photos.map((photo) => [photo.hash, photo]));
    for (const [index, file] of picked.entries()) {
      adding.hidden = false;
      adding.textContent = `Adding photos… ${index + 1} of ${picked.length}`;
      const read = await processFile(file);
      const known = read.kind === 'photo' ? byHash.get(read.hash) : undefined;
      if (read.kind === 'not-a-photo') result.notPhotos += 1;
      else if (read.kind === 'failed') result.failed += 1;
      else if (known?.here) result.duplicates += 1;
      else {
        const photo: Photo = known
          ? { ...known, here: true }
          : {
              id: crypto.randomUUID(),
              taken: read.taken ?? localDateTime(new Date(file.lastModified || Date.now())),
              added: Date.now(),
              name: file.name,
              type: file.type,
              size: file.size,
              width: read.width,
              height: read.height,
              hash: read.hash,
              online: null,
              here: true,
            };
        try {
          await savePhoto(photo, {
            id: photo.id,
            original: file,
            view: read.view,
            thumb: read.thumb,
          });
          byHash.set(photo.hash, photo);
          photos = [...photos.filter((one) => one.id !== photo.id), photo].sort(byNewest);
          if (known) result.restored += 1;
          else result.added += 1;
          render();
        } catch {
          result.failed += 1;
        }
      }
    }
    adding.hidden = true;
    busy = false;
    setBusy(addButton, false);
    // Photos that couldn't be saved show in the page's notice too.
    if (result.failed > 0) showProblem(`${addedMessage(result)} This device may be out of space.`);
    else announce(addedMessage(result));
    addButton.focus();
    if (result.added > 0) online.added();
  }

  // ---------- Choosing several ----------

  function renderChoosing(): void {
    selection.hidden = !choosing;
    selectedCount.textContent =
      chosen.size === 0
        ? 'Tap photos to choose them.'
        : `${countLabel(chosen.size, 'photo', 'photos')} chosen`;
    for (const action of ['save-selected', 'delete-selected']) {
      required<HTMLButtonElement>(selection, `[data-action="${action}"]`).disabled =
        chosen.size === 0;
    }
  }

  function startChoosing(): void {
    choosing = true;
    chosen.clear();
    render();
    required<HTMLElement>(selection, '[data-action="done-selecting"]').focus();
    announce('Tap photos to choose them.');
  }

  function stopChoosing(): void {
    choosing = false;
    chosen.clear();
    render();
    selectButton.focus();
  }

  function toggleChosen(button: HTMLButtonElement): void {
    const id = button.dataset['id'] ?? '';
    if (chosen.has(id)) chosen.delete(id);
    else chosen.add(id);
    button.ariaPressed = String(chosen.has(id));
    renderChoosing();
  }

  /** Saves each chosen photo's original, one after the other. */
  async function saveChosen(): Promise<void> {
    const list = photos.filter((photo) => chosen.has(photo.id));
    let saved = 0;
    for (const photo of list) if (await saveOriginal(photo, false)) saved += 1;
    if (saved === list.length) announce(`Saved ${countLabel(saved, 'original', 'originals')}.`);
    else {
      problem(
        `Saved ${countLabel(saved, 'original', 'originals')}. ${countLabel(list.length - saved, 'couldn’t', 'couldn’t')} be downloaded: check your connection and try again.`,
      );
    }
  }

  // ---------- Looking at a photo ----------

  async function showPhoto(id: string): Promise<void> {
    const photo = find(id);
    if (!photo) return;
    if (viewing?.url) URL.revokeObjectURL(viewing.url);
    viewing = { id, url: null };
    viewerImage.removeAttribute('src');
    viewerImage.alt = photoAlt(photo);
    viewerNone.hidden = true;
    viewerTitle.textContent = takenLabel(photo.taken);
    const index = photos.indexOf(photo);
    required<HTMLElement>(viewer, '[data-detail="name"]').textContent = photo.name || 'No name';
    required<HTMLElement>(viewer, '[data-detail="size"]').textContent =
      photo.width && photo.height
        ? `${formatBytes(photo.size)} · ${photo.width.toLocaleString()} × ${photo.height.toLocaleString()}`
        : formatBytes(photo.size);
    required<HTMLElement>(viewer, '[data-detail="kind"]').textContent =
      `${formatLabel(photo)} · ${index + 1} of ${photos.length.toLocaleString()}`;
    required<HTMLElement>(viewer, '[data-detail="where"]').textContent = whereLabel(photo);
    for (const action of ['previous-photo', 'next-photo']) {
      required<HTMLElement>(viewer, `[data-action="${action}"]`).hidden = photos.length < 2;
    }
    renderSaveOriginal();
    // The screen-sized copy: from this device, or downloaded (photos only online).
    const view =
      (await getFiles(id))?.view ?? (photo.online ? await online.download(photo, 'view') : null);
    if (viewing.id !== id) return;
    viewing.url = view ? URL.createObjectURL(view) : null;
    if (viewing.url) viewerImage.src = viewing.url;
    viewerNone.textContent =
      photo.here || photo.online?.parts[1] === 0
        ? 'This browser can’t show this kind of photo. “Save original” saves it as it is, to open in another app.'
        : 'Couldn’t download this photo. Check your connection and try again.';
    viewerNone.hidden = viewing.url !== null;
  }

  function openPhoto(id: string): void {
    if (!viewer.open) viewer.showModal();
    void showPhoto(id);
  }

  function stepPhoto(by: number): void {
    if (!viewing || photos.length === 0) return;
    const index = photos.findIndex((photo) => photo.id === viewing?.id);
    const next = photos[(index + by + photos.length) % photos.length];
    if (next) void showPhoto(next.id);
  }

  viewer.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') stepPhoto(-1);
    else if (event.key === 'ArrowRight') stepPhoto(1);
  });

  viewer.addEventListener('close', () => {
    const id = viewing?.id;
    if (viewing?.url) URL.revokeObjectURL(viewing.url);
    viewing = null;
    tellInViewer('');
    viewerImage.removeAttribute('src');
    // Back to the photo in the grid (showing it, if it's further down).
    const at = photos.findIndex((photo) => photo.id === id);
    if (at >= shown) {
      shown = Math.ceil((at + 1) / PAGE_SIZE) * PAGE_SIZE;
      render();
    }
    (monthsList.querySelector<HTMLElement>(`[data-id="${id ?? ''}"]`) ?? libraryHeading).focus();
  });

  /** Photos whose originals are downloading: "Save original" waits for them. */
  const downloading = new Set<string>();

  /** "Save original" looks unavailable while its photo's original downloads (it still keeps focus). */
  function renderSaveOriginal(): void {
    if (viewing && downloading.has(viewing.id)) {
      saveOriginalButton.setAttribute('aria-disabled', 'true');
    } else saveOriginalButton.removeAttribute('aria-disabled');
  }

  /**
   * Saves the original file, exactly as it was added: from this device, or
   * downloaded from the online library. False if it couldn't be. With `say`,
   * the viewer shows how it's going ("Downloading the original…").
   */
  async function saveOriginal(photo: Photo, say = true): Promise<boolean> {
    if (downloading.has(photo.id)) return false;
    downloading.add(photo.id);
    let original: Blob | null;
    try {
      original = (await getFiles(photo.id))?.original ?? null;
      if (!original && photo.online) {
        if (say) tellInViewer('Downloading the original…');
        renderSaveOriginal();
        original = await online.download(photo, 'original');
      }
    } finally {
      downloading.delete(photo.id);
      renderSaveOriginal();
    }
    if (!original) {
      if (say) {
        problem(
          photo.here
            ? 'Couldn’t find that photo’s original on this device.'
            : 'Couldn’t download the original. Check your connection and try again.',
        );
      }
      return false;
    }
    saveFile(original, downloadName(photo));
    if (say && !photo.here) {
      if (viewer.open) tellInViewer('Downloaded the original.');
      else announce('Downloaded the original.');
    }
    return true;
  }

  // ---------- Deleting ----------

  function askToDelete(ids: string[]): void {
    deleting = ids;
    deleteTitle.textContent =
      ids.length === 1
        ? 'Delete this photo?'
        : `Delete ${countLabel(ids.length, 'photo', 'photos')}?`;
    deleteText.textContent = online.state().on
      ? `${ids.length === 1 ? 'It’s' : 'They’re'} deleted from this device and from your online library, so from your other devices too. This can’t be undone.`
      : `The original${ids.length === 1 ? ' and its copies are' : 's and their copies are'} deleted from this device. This can’t be undone.`;
    deleteDialog.returnValue = '';
    deleteDialog.showModal();
  }

  deleteDialog.addEventListener('close', () => {
    const ids = deleting;
    deleting = [];
    if (deleteDialog.returnValue !== 'confirm' || ids.length === 0) return;
    void removePhotos(ids);
  });

  async function removePhotos(ids: readonly string[]): Promise<void> {
    // Where to go next in the viewer: the photo after the deleted one.
    const at = viewing ? photos.findIndex((photo) => photo.id === viewing?.id) : -1;
    const gone = new Set(ids);
    try {
      // Online too (now, or when sync is on again).
      await online.removed(photos.filter((photo) => gone.has(photo.id)));
      await deletePhotos(ids);
    } catch {
      problem('Couldn’t delete. Please try again.');
      return;
    }
    photos = photos.filter((photo) => !gone.has(photo.id));
    for (const id of ids) chosen.delete(id);
    if (choosing && photos.length === 0) choosing = false;
    render();
    announce(
      ids.length === 1
        ? 'Deleted the photo.'
        : `Deleted ${countLabel(ids.length, 'photo', 'photos')}.`,
    );
    if (viewer.open) {
      const next = photos[Math.min(at, photos.length - 1)];
      if (next) {
        await showPhoto(next.id);
        required<HTMLElement>(viewer, '[data-action="delete-photo"]').focus();
      } else viewer.close();
    } else if (choosing) {
      required<HTMLElement>(selection, '[data-action="done-selecting"]').focus();
    } else {
      (photos.length > 0 ? selectButton : addButton).focus();
    }
  }

  // ---------- Freeing up space ----------

  function askToFreeUp(): void {
    const { photos: list, bytes } = freeable(photos);
    if (list.length === 0 || !canFreeUp(online.state())) return;
    freeUpText.textContent =
      list.length === 1
        ? `This removes the original of 1 photo (${formatBytes(bytes)}) from this device. It stays in your online library: the photo still shows here, and “Save original” downloads it again.`
        : `This removes the originals of ${countLabel(list.length, 'photo', 'photos')} (${formatBytes(bytes)}) from this device. They stay in your online library: every photo still shows here, and “Save original” downloads it again.`;
    freeUpDialog.returnValue = '';
    freeUpDialog.showModal();
  }

  freeUpDialog.addEventListener('close', () => {
    if (freeUpDialog.returnValue !== 'confirm') return;
    void online.freeUpSpace(freeable(photos).photos).then(
      (bytes) => {
        announce(`Freed up ${formatBytes(bytes)} on this device.`);
        libraryHeading.focus();
      },
      () => problem('Couldn’t free up space. Please try again.'),
    );
  });

  // ---------- Buttons ----------

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-action]');
    const current = find(viewing?.id);
    switch (button?.dataset['action']) {
      case 'tile':
        if (choosing) toggleChosen(button);
        else openPhoto(button.dataset['id'] ?? '');
        break;
      case 'select':
        startChoosing();
        break;
      case 'done-selecting':
        stopChoosing();
        break;
      case 'save-selected':
        void saveChosen();
        break;
      case 'delete-selected':
        askToDelete(photos.filter((photo) => chosen.has(photo.id)).map((photo) => photo.id));
        break;
      case 'previous-photo':
        stepPhoto(-1);
        break;
      case 'next-photo':
        stepPhoto(1);
        break;
      case 'save-original':
        // Not again while it's downloading (a second tap would start a second download).
        if (current && !downloading.has(current.id)) void saveOriginal(current);
        break;
      case 'delete-photo':
        if (current) askToDelete([current.id]);
        break;
      case 'close-viewer':
        viewer.close();
        break;
      case 'free-up-space':
        askToFreeUp();
        break;
    }
  });

  // If Photos is open in another tab too, show what it adds or deletes. Only
  // then: loading the whole library takes seconds when it's big (audit J-3).
  window.addEventListener('focus', () => {
    if (!busy && changedElsewhere()) void reload();
  });

  /** What the list shows about each photo, to see whether a reload changed anything. */
  const shape = (list: readonly Photo[]) =>
    list.map((photo) => `${photo.id}:${photo.here}:${photo.online ? 1 : 0}`).join();

  async function reload(): Promise<void> {
    try {
      let loaded = await loadLibrary();
      // Photos only online need sync: without it, they can't be seen here.
      // Where this device had got to starts again too, so they're found
      // again when sync is on (audit F3-2).
      const hidden = onlyOnline(loaded);
      if (!online.state().on && hidden.length > 0) {
        await online.hideOnlyOnline(hidden.map((photo) => photo.id));
        loaded = loaded.filter((photo) => photo.here);
      }
      if (shape(loaded) === shape(photos)) return;
      photos = loaded;
      const known = new Set(photos.map((photo) => photo.id));
      for (const id of chosen) if (!known.has(id)) chosen.delete(id);
      render();
    } catch {
      problem('Couldn’t open the photos on this device. Is storage blocked in this browser?');
    }
  }

  void reload().then(render);
}
