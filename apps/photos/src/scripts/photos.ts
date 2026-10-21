/**
 * Photos' page behaviour: connects pages/index.astro to the rules in
 * lib/photos.ts and the library on this device (library.ts). Picked photos
 * are read in a worker (process.ts), one at a time.
 */
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
import { deletePhotos, getFiles, loadLibrary, savePhoto, thumbUrl } from './library.ts';
import { processFile } from './process.ts';

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Photos: missing element ${selector}`);
  return element;
}

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
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteTitle = required<HTMLElement>(deleteDialog, '[data-delete-title]');

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

  const announce = (message: string): void => {
    announcer.textContent = message;
  };
  const find = (id: string | undefined) => photos.find((photo) => photo.id === id);

  // ---------- Showing the library ----------

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
    void thumbUrl(photo.id).then((url) => {
      if (url) image.src = url;
      else format.hidden = false;
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

  /** Reads and saves picked photos one at a time; the same photo isn't added twice. */
  async function addPhotos(picked: readonly File[]): Promise<void> {
    busy = true;
    addButton.disabled = true;
    const result: Added = { added: 0, duplicates: 0, notPhotos: 0, failed: 0 };
    const hashes = new Set(photos.map((photo) => photo.hash));
    for (const [index, file] of picked.entries()) {
      adding.hidden = false;
      adding.textContent = `Adding photos… ${index + 1} of ${picked.length}`;
      const read = await processFile(file);
      if (read.kind === 'not-a-photo') result.notPhotos += 1;
      else if (read.kind === 'failed') result.failed += 1;
      else if (hashes.has(read.hash)) result.duplicates += 1;
      else {
        const photo: Photo = {
          id: crypto.randomUUID(),
          taken: read.taken ?? localDateTime(new Date(file.lastModified || Date.now())),
          added: Date.now(),
          name: file.name,
          type: file.type,
          size: file.size,
          width: read.width,
          height: read.height,
          hash: read.hash,
        };
        try {
          await savePhoto(photo, {
            id: photo.id,
            original: file,
            view: read.view,
            thumb: read.thumb,
          });
          hashes.add(photo.hash);
          photos = [...photos, photo].sort(byNewest);
          result.added += 1;
          render();
        } catch {
          result.failed += 1;
        }
      }
    }
    adding.hidden = true;
    busy = false;
    addButton.disabled = false;
    announce(
      result.failed > 0
        ? `${addedMessage(result)} This device may be out of space.`
        : addedMessage(result),
    );
    addButton.focus();
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
    for (const photo of list) await saveOriginal(photo);
    announce(`Saved ${countLabel(list.length, 'original', 'originals')}.`);
  }

  // ---------- Looking at a photo ----------

  async function showPhoto(id: string): Promise<void> {
    const photo = find(id);
    if (!photo) return;
    if (viewing?.url) URL.revokeObjectURL(viewing.url);
    viewing = { id, url: null };
    const files = await getFiles(id);
    if (viewing.id !== id) return;
    viewing.url = files?.view ? URL.createObjectURL(files.view) : null;
    if (viewing.url) viewerImage.src = viewing.url;
    else viewerImage.removeAttribute('src');
    viewerImage.alt = photoAlt(photo);
    viewerNone.hidden = viewing.url !== null;
    viewerTitle.textContent = takenLabel(photo.taken);
    const index = photos.indexOf(photo);
    required<HTMLElement>(viewer, '[data-detail="name"]').textContent = photo.name || 'No name';
    required<HTMLElement>(viewer, '[data-detail="size"]').textContent =
      photo.width && photo.height
        ? `${formatBytes(photo.size)} · ${photo.width.toLocaleString()} × ${photo.height.toLocaleString()}`
        : formatBytes(photo.size);
    required<HTMLElement>(viewer, '[data-detail="kind"]').textContent =
      `${formatLabel(photo)} · ${index + 1} of ${photos.length.toLocaleString()}`;
    for (const action of ['previous-photo', 'next-photo']) {
      required<HTMLElement>(viewer, `[data-action="${action}"]`).hidden = photos.length < 2;
    }
  }

  function openPhoto(id: string): void {
    void showPhoto(id).then(() => {
      if (!viewer.open) viewer.showModal();
    });
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
    viewerImage.removeAttribute('src');
    // Back to the photo in the grid (showing it, if it's further down).
    const at = photos.findIndex((photo) => photo.id === id);
    if (at >= shown) {
      shown = Math.ceil((at + 1) / PAGE_SIZE) * PAGE_SIZE;
      render();
    }
    (monthsList.querySelector<HTMLElement>(`[data-id="${id ?? ''}"]`) ?? libraryHeading).focus();
  });

  /** Saves the original file, exactly as it was added. */
  async function saveOriginal(photo: Photo): Promise<void> {
    const files = await getFiles(photo.id);
    if (!files) {
      announce('Couldn’t find that photo’s original on this device.');
      return;
    }
    saveFile(files.original, downloadName(photo));
  }

  // ---------- Deleting ----------

  function askToDelete(ids: string[]): void {
    deleting = ids;
    deleteTitle.textContent =
      ids.length === 1
        ? 'Delete this photo?'
        : `Delete ${countLabel(ids.length, 'photo', 'photos')}?`;
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
    try {
      await deletePhotos(ids);
    } catch {
      announce('Couldn’t delete. Please try again.');
      return;
    }
    const gone = new Set(ids);
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
        if (current) void saveOriginal(current);
        break;
      case 'delete-photo':
        if (current) askToDelete([current.id]);
        break;
      case 'close-viewer':
        viewer.close();
        break;
    }
  });

  // If Photos is open in another tab too, show what it adds or deletes.
  window.addEventListener('focus', () => {
    if (!busy) void reload();
  });

  async function reload(): Promise<void> {
    try {
      const loaded = await loadLibrary();
      const before = photos.map((photo) => photo.id).join();
      if (loaded.map((photo) => photo.id).join() === before) return;
      photos = loaded;
      const known = new Set(photos.map((photo) => photo.id));
      for (const id of chosen) if (!known.has(id)) chosen.delete(id);
      render();
    } catch {
      announce('Couldn’t open the photos on this device. Is storage blocked in this browser?');
    }
  }

  void reload().then(render);
}
