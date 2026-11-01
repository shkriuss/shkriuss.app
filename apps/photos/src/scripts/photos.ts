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
import { keepFocus } from '@shkriuss/ui/keep-focus';
import {
  canFreeUp,
  deleteMessage,
  freeable,
  notOnlineMessage,
  onlineMessage,
  onlyOnline,
} from '../lib/online.ts';
import {
  addedMessage,
  byMonth,
  copiesToKeep,
  countLabel,
  downloadName,
  formatBytes,
  formatLabel,
  isIPhoneOrIPad,
  librarySummary,
  localDateTime,
  monthLabel,
  PAGE_SIZE,
  PARTS,
  photoAlt,
  shownLabel,
  takenLabel,
  withAdded,
  withChanges,
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
  const loadingNote = required<HTMLElement>(root, '[data-loading]');
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
  const viewerAnnouncer = required<HTMLElement>(viewer, '[data-viewer-announcer]');
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
  const unlockButton = required<HTMLButtonElement>(unlockForm, 'button[type="submit"]');
  const unlockStatus = required<HTMLElement>(unlockForm, '[data-unlock-status]');
  const freeUp = required<HTMLElement>(root, '[data-free-up]');
  const freeUpButton = required<HTMLButtonElement>(freeUp, '[data-action="free-up-space"]');
  const freeUpStatus = required<HTMLElement>(freeUp, '[data-free-up-status]');
  const freeUpDialog = required<HTMLDialogElement>(root, '[data-free-up-dialog]');
  const freeUpText = required<HTMLElement>(freeUpDialog, '[data-free-up-text]');
  const deleteAllNote = required<HTMLElement>(root, '[data-delete-note]');

  /** Every photo, newest first. */
  let photos: Photo[] = [];
  /**
   * Whether the library on this device has been loaded since the page
   * opened; `ready` resolves then. Until it has, `photos` is empty whatever
   * the device holds, which takes seconds when the library is big, so
   * nothing is compared with it before (audit 3 F3-8).
   */
  let loaded = false;
  let markLoaded = (): void => undefined;
  const ready = new Promise<void>((resolve) => {
    markLoaded = resolve;
  });
  let shown = PAGE_SIZE;
  let busy = false;
  /** While "Free up space" asks the online library and removes originals. */
  let freeing = false;
  /** While choosing photos: the chosen ones. */
  let choosing = false;
  const chosen = new Set<string>();
  /** The photo being looked at, and its URL while it's shown. */
  let viewing: { id: string; url: string | null } | null = null;
  /** What the delete dialog would delete, and whether it said online too. */
  let deleting: string[] = [];
  let deletingEverywhere = false;
  let renderTimer: number | undefined;

  const announce = (message: string): void => {
    // In the photo viewer while it's open: the page behind it can't be heard (audit 3 G-8).
    (viewer.open ? viewerAnnouncer : announcer).textContent = message;
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
    ready,
    all: () => photos,
    get: find,
    changed({ save = [], remove = [] }) {
      if (save.length === 0 && remove.length === 0) return;
      photos = withChanges(photos, save, remove);
      for (const id of remove) chosen.delete(id);
      if (viewing && remove.includes(viewing.id) && viewer.open) viewer.close();
      // Many changes can come in a row: show them together. Drawn in the
      // background (after each upload, too), so keyboard focus stays on the
      // photo it was on (audit 3 G-1).
      window.clearTimeout(renderTimer);
      renderTimer = window.setTimeout(() => keepFocus(render, libraryHeading), 100);
    },
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), online.sync);
  online.subscribe(renderOnline);

  function renderOnline(): void {
    const state = online.state();
    onlineOff.hidden = state.on;
    onlineSection.hidden = !state.on;
    // "Delete all data?" says the online copy keeps its data: not photos that aren't in it yet (audit 6 E-3).
    deleteAllNote.textContent = notOnlineMessage(photos, state.on);
    deleteAllNote.hidden = deleteAllNote.textContent === '';
    if (!state.on) return;
    onlineStatus.textContent = onlineMessage(state);
    unlockForm.hidden = !state.checked || state.unlocked || state.problem === 'not-set-up';
    // Only once the library has answered: this device's note that photos are online may be old.
    // Not while it's freeing up space, which has focus.
    freeUp.hidden = !freeing && (!canFreeUp(state) || freeable(photos).photos.length === 0);
  }

  function codeProblem(message: string): void {
    unlockError.textContent = message;
    storageCode.setAttribute('aria-invalid', 'true');
    focusProblem(storageCode, message);
  }

  // Says it's checking, and a second press meanwhile isn't a second try:
  // wrong ones count against those allowed an hour (audit 4 G-6).
  let unlocking = false;
  unlockForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (unlocking) return;
    const code = storageCode.value;
    if (!code) {
      codeProblem('Enter the storage code.');
      return;
    }
    unlockError.textContent = '';
    storageCode.removeAttribute('aria-invalid');
    unlocking = true;
    setBusy(unlockButton, true);
    unlockStatus.textContent = 'Checking the storage code…';
    void online
      .unlock(code)
      .catch(() => 'offline' as const)
      .then((result) => {
        unlocking = false;
        setBusy(unlockButton, false);
        unlockStatus.textContent = '';
        if (result === 'ok') {
          storageCode.value = '';
          announce('Online storage is unlocked. Your photos are going online.');
          onlineStatus.focus();
          return;
        }
        codeProblem(
          {
            wrong: 'That isn’t the storage code. Check it and try again.',
            'too-many': 'Too many wrong tries. Try again in an hour.',
            'not-set-up': 'Online storage isn’t set up yet.',
            offline: 'Couldn’t reach the online library. Check your connection and try again.',
          }[result],
        );
      });
  });

  // ---------- Showing the library ----------

  /**
   * A photo's thumbnail: from this device, or downloaded from the online
   * library, which has one (also for a photo here that this browser
   * couldn't make one for, like a HEIC outside Safari: audit 5 F3-6).
   */
  async function photoThumb(photo: Photo): Promise<string | null> {
    return (
      (await thumbUrl(photo.id)) ?? (photo.online?.parts[PARTS.thumb] ? online.thumb(photo) : null)
    );
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
    // "No photos yet" only once the library is loaded: before, it would make
    // people think their photos are gone (audit 3 F3-8).
    loadingNote.hidden = loaded;
    empty.hidden = !loaded || photos.length > 0;
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
    monthsList.querySelector<HTMLElement>(`[data-id="${CSS.escape(first?.id ?? '')}"]`)?.focus();
  });

  // ---------- Adding photos ----------

  // On iPhone and iPad, picked photos may be JPEG copies: the page says so,
  // and how to keep the originals (audit 3 F3-3).
  required<HTMLElement>(root, '[data-apple-hint]').hidden = !isIPhoneOrIPad(
    navigator.userAgent,
    navigator.maxTouchPoints,
  );

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
    // Picked while the library loads: checked against all of it (audit 3 F3-8).
    await ready;
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
          // Picked again: copies this browser couldn't make stay as they were (audit 5 F3-6).
          const kept = known ? await getFiles(known.id) : undefined;
          await savePhoto(photo, { id: photo.id, original: file, ...copiesToKeep(read, kept) });
          byHash.set(photo.hash, photo);
          photos = known ? withChanges(photos, [photo]) : withAdded(photos, photo);
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

  /** Above this share of the screen's height, the bar scrolls with the page instead of staying in sight. */
  const TALL = 0.3;
  // With large text the bar is tall: it mustn't cover most of the photos (audit G-12).
  const fitSelection = (): void => {
    const height = selection.getBoundingClientRect().height;
    selection.classList.toggle('selection--tall', height > window.innerHeight * TALL);
  };
  new ResizeObserver(fitSelection).observe(selection);
  window.addEventListener('resize', fitSelection);

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
    // A problem with the photo shown before isn't this one's.
    if (viewerStatus.hasAttribute('data-problem')) tellInViewer('');
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
    // The screen-sized copy: from this device, or downloaded from the online
    // library, which has one (also for a photo here that this browser
    // couldn't make one for: audit 5 F3-6).
    const downloadable = online.state().on && (photo.online?.parts[PARTS.view] ?? 0) > 0;
    const view =
      (await getFiles(id))?.view ?? (downloadable ? await online.download(photo, 'view') : null);
    // Another photo is shown now, or the viewer was closed while this one downloaded.
    if (viewing?.id !== id) return;
    viewing.url = view ? URL.createObjectURL(view) : null;
    if (viewing.url) viewerImage.src = viewing.url;
    const problem = downloadable
      ? 'Couldn’t download this photo. Check your connection and try again.'
      : 'This browser can’t show this kind of photo. “Save original” saves it as it is, to open in another app.';
    viewerNone.textContent = problem;
    viewerNone.hidden = viewing.url !== null;
    // A failed download is read out too: focus is on the title, which says
    // nothing of it (audit 5 G-7).
    if (viewing.url === null && downloadable) tellInViewer(problem, true);
  }

  function openPhoto(id: string): void {
    const opening = !viewer.open;
    if (opening) viewer.showModal();
    void showPhoto(id);
    // Focus starts on which photo it is, not on "Previous", where Enter would
    // show another one (audit G-14).
    if (opening) viewerTitle.focus();
  }

  function stepPhoto(by: number): void {
    if (!viewing || photos.length === 0) return;
    const index = photos.findIndex((photo) => photo.id === viewing?.id);
    const at = (index + by + photos.length) % photos.length;
    const next = photos[at];
    if (!next) return;
    void showPhoto(next.id);
    // Focus stays on Next or Previous: say which photo is shown now (audit 3 G-8).
    announce(shownLabel(next, at, photos.length));
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
    viewerAnnouncer.textContent = '';
    viewerImage.removeAttribute('src');
    // Back to the photo in the grid (showing it, if it's further down).
    const at = photos.findIndex((photo) => photo.id === id);
    if (at >= shown) {
      shown = Math.ceil((at + 1) / PAGE_SIZE) * PAGE_SIZE;
      render();
    }
    (
      monthsList.querySelector<HTMLElement>(`[data-id="${CSS.escape(id ?? '')}"]`) ?? libraryHeading
    ).focus();
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
    // With sync off, from this device only. What the dialog says is what's
    // done, even if sync is turned on or off before it's answered (audit 3 F3-1).
    deletingEverywhere = online.state().on;
    const asked = new Set(ids);
    const inLibrary = photos.filter((photo) => asked.has(photo.id) && photo.online).length;
    deleteTitle.textContent =
      ids.length === 1
        ? 'Delete this photo?'
        : `Delete ${countLabel(ids.length, 'photo', 'photos')}?`;
    deleteText.textContent = deleteMessage(ids.length, inLibrary, deletingEverywhere);
    deleteDialog.returnValue = '';
    deleteDialog.showModal();
  }

  deleteDialog.addEventListener('close', () => {
    const ids = deleting;
    deleting = [];
    if (deleteDialog.returnValue !== 'confirm' || ids.length === 0) return;
    void removePhotos(ids, deletingEverywhere);
  });

  async function removePhotos(ids: readonly string[], everywhere: boolean): Promise<void> {
    // Where to go next in the viewer: the photo after the deleted one.
    const at = viewing ? photos.findIndex((photo) => photo.id === viewing?.id) : -1;
    const gone = new Set(ids);
    try {
      // Online too, now or when sync is on again, if the dialog said so.
      await online.removed(
        photos.filter((photo) => gone.has(photo.id)),
        everywhere,
      );
      await deletePhotos(ids);
    } catch {
      problem('Couldn’t delete. Please try again.');
      return;
    }
    photos = photos.filter((photo) => !gone.has(photo.id));
    for (const id of ids) chosen.delete(id);
    if (choosing && photos.length === 0) choosing = false;
    render();
    const deleted =
      ids.length === 1
        ? 'Deleted the photo.'
        : `Deleted ${countLabel(ids.length, 'photo', 'photos')}.`;
    if (viewer.open) {
      const index = Math.min(at, photos.length - 1);
      const next = photos[index];
      if (next) {
        // Said in the viewer, with the photo it shows now (audit 3 G-8).
        announce(`${deleted} ${shownLabel(next, index, photos.length)}.`);
        await showPhoto(next.id);
        required<HTMLElement>(viewer, '[data-action="delete-photo"]').focus();
      } else {
        viewer.close();
        announce(deleted);
      }
      return;
    }
    announce(deleted);
    if (choosing) {
      required<HTMLElement>(selection, '[data-action="done-selecting"]').focus();
    } else {
      (photos.length > 0 ? selectButton : addButton).focus();
    }
  }

  // ---------- Freeing up space ----------

  function askToFreeUp(): void {
    const { photos: list, bytes } = freeable(photos);
    if (freeing || list.length === 0 || !canFreeUp(online.state())) return;
    freeUpText.textContent =
      list.length === 1
        ? `This removes the original of 1 photo (${formatBytes(bytes)}) from this device. It stays in your online library: the photo still shows here, and “Save original” downloads it again.`
        : `This removes the originals of ${countLabel(list.length, 'photo', 'photos')} (${formatBytes(bytes)}) from this device. They stay in your online library: every photo still shows here, and “Save original” downloads it again.`;
    freeUpDialog.returnValue = '';
    freeUpDialog.showModal();
  }

  // It asks the online library first, after any upload under way, which can
  // take a while: it says so, and the button is busy, so a second press
  // isn't a second go (audit 6 G-5).
  freeUpDialog.addEventListener('close', () => {
    if (freeUpDialog.returnValue !== 'confirm' || freeing) return;
    freeing = true;
    setBusy(freeUpButton, true);
    freeUpStatus.textContent = 'Freeing up space…';
    void online
      .freeUpSpace(freeable(photos).photos)
      .then(
        (bytes) => `Freed up ${formatBytes(bytes)} on this device.`,
        () => null,
      )
      .then((freed) => {
        freeing = false;
        setBusy(freeUpButton, false);
        freeUpStatus.textContent = '';
        renderOnline();
        if (freed) {
          announce(freed);
          libraryHeading.focus();
          return;
        }
        problem('Couldn’t free up space. Please try again.');
        // Gone meanwhile (the library can't be reached now, say): focus isn't lost with it.
        if (freeUp.hidden) libraryHeading.focus();
      });
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
      // Changed in another tab: keyboard focus stays where it was (audit 3 G-1).
      keepFocus(render, libraryHeading);
    } catch {
      problem('Couldn’t open the photos on this device. Is storage blocked in this browser?');
    }
  }

  void reload().then(() => {
    loaded = true;
    markLoaded();
    render();
  });
}
