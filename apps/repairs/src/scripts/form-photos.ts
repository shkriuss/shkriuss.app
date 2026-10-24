/**
 * Repairs: the photos in the repair form. Picked photos are made smaller one
 * at a time and kept in the form until it's saved; removing a saved photo
 * deletes it only once the form is saved. Split from repairs.ts (audit J-7).
 */
import { required } from '@shkriuss/ui/dom';
import { countLabel, LIMITS } from '../lib/repairs.ts';
import {
  deletePhotos,
  makePhoto,
  NotAPhotoError,
  rememberThumb,
  savePhotos,
  thumbUrl,
  type PhotoFile,
} from './photos.ts';

export interface FormPhotos {
  /** Opening the form: shows these photos (the repair's, or none). */
  reset(ids: readonly string[]): void;
  /** Closing the form: photos picked but not saved are deleted, unless the form is saving them. */
  close(saving: boolean): void;
  /** The photos the repair will have. */
  ids(): string[];
  /** Those, and photos picked but not saved: none of them may be deleted. */
  inUse(): string[];
  /** Waits for picked photos still being made smaller. */
  ready(): Promise<void>;
  /**
   * Saves picked photos on the device and deletes removed ones. Null if
   * saving didn't work (the form says so).
   */
  save(): Promise<{ added: string[]; removed: string[] } | null>;
  /** "Add photos": opens the file picker. */
  pick(): void;
  remove(id: string): void;
}

export function mountFormPhotos(
  root: ParentNode,
  form: HTMLFormElement,
  { syncOn }: { syncOn(): boolean },
): FormPhotos {
  const formPhotoTemplate = required<HTMLTemplateElement>(root, '[data-form-photo-template]');
  const formPhotoList = required<HTMLUListElement>(form, '[data-form-photos]');
  const formPhotosElsewhere = required<HTMLElement>(form, '[data-form-photos-elsewhere]');
  const photosSyncHint = required<HTMLElement>(form, '[data-photos-sync-hint]');
  const photosBusy = required<HTMLElement>(form, '[data-photos-busy]');
  const photoError = required<HTMLElement>(form, '[data-error-for="photos"]');
  const photoInput = required<HTMLInputElement>(form, '[data-photo-input]');
  const addPhotosButton = required<HTMLButtonElement>(form, '[data-action="add-photos"]');

  /** The repair form's photos: every id (some may be on another device)… */
  let formPhotos: string[] = [];
  /** …the ones picked but not saved yet… */
  const pendingPhotos = new Map<string, PhotoFile>();
  /** …and saved ones removed in the form (deleted once it's saved). */
  let removedPhotos: string[] = [];
  /** Picked photos being made smaller; saving waits for them. */
  let addingPhotos: Promise<void> = Promise.resolve();
  /** Counts the times the repair form was opened, so late photos don't land in the next one. */
  let formSession = 0;

  /** Shows the form's photos; says how many are on another device. */
  async function renderFormPhotos(): Promise<void> {
    const ids = [...formPhotos];
    const urls = await Promise.all(ids.map(thumbUrl));
    // Changed again meanwhile: that render shows the latest.
    if (ids.join() !== formPhotos.join()) return;
    const here = ids.flatMap((id, index) => {
      const url = urls[index];
      return url ? [{ id, url }] : [];
    });
    formPhotoList.replaceChildren(
      ...here.map(({ id, url }, index) => {
        const fragment = formPhotoTemplate.content.cloneNode(true) as DocumentFragment;
        const entry = required<HTMLLIElement>(fragment, 'li');
        entry.dataset['photo'] = id;
        const image = required<HTMLImageElement>(entry, '[data-thumb]');
        image.src = url;
        image.alt = `Photo ${index + 1}`;
        required<HTMLElement>(entry, '[data-action="remove-photo"]').ariaLabel =
          `Remove photo ${index + 1}`;
        return entry;
      }),
    );
    const elsewhere = ids.length - here.length;
    const syncing = syncOn();
    formPhotosElsewhere.hidden = elsewhere === 0;
    formPhotosElsewhere.textContent = syncing
      ? elsewhere === 1
        ? '1 photo hasn’t arrived on this device yet. It stays with this repair.'
        : `${elsewhere} photos haven’t arrived on this device yet. They stay with this repair.`
      : elsewhere === 1
        ? '1 photo is on another device. It stays with this repair.'
        : `${elsewhere} photos are on another device. They stay with this repair.`;
    photosSyncHint.textContent = syncing
      ? 'They sync to your other devices, locked so only you can see them. They aren’t in backups.'
      : 'Kept on this device, and not in backups. Turn on sync to have them on your other devices too.';
    addPhotosButton.hidden = ids.length >= LIMITS.photos;
  }

  function showPhotoProblem(problem: string): void {
    photoError.textContent = problem;
  }

  /** Makes the picked files into photos, one at a time, and adds them. */
  async function addPhotos(picked: readonly File[]): Promise<void> {
    const session = formSession;
    const room = LIMITS.photos - formPhotos.length;
    const problems: string[] = [];
    if (picked.length > room) {
      problems.push(
        `A repair can have up to ${LIMITS.photos} photos, so ${countLabel(picked.length - room, 'photo wasn’t', 'photos weren’t')} added.`,
      );
    }
    photosBusy.hidden = false;
    for (const file of picked.slice(0, Math.max(0, room))) {
      try {
        const photo = await makePhoto(file);
        // The form was closed meanwhile: this photo isn't wanted.
        if (session !== formSession) break;
        pendingPhotos.set(photo.id, photo);
        rememberThumb(photo);
        formPhotos = [...formPhotos, photo.id];
        await renderFormPhotos();
      } catch (error) {
        problems.push(
          error instanceof NotAPhotoError ? error.message : 'Couldn’t read a photo. Try again.',
        );
      }
    }
    photosBusy.hidden = true;
    if (session === formSession) showPhotoProblem(problems.join(' '));
  }

  photoInput.addEventListener('change', () => {
    const picked = [...(photoInput.files ?? [])];
    photoInput.value = '';
    if (picked.length === 0) return;
    showPhotoProblem('');
    addingPhotos = addingPhotos.then(() => addPhotos(picked));
  });

  /** Forgets photos picked in the form but not saved (it was closed without saving). */
  function dropPendingPhotos(): void {
    if (pendingPhotos.size > 0) void deletePhotos([...pendingPhotos.keys()]);
    pendingPhotos.clear();
  }

  return {
    reset(ids) {
      formSession += 1;
      dropPendingPhotos();
      formPhotos = [...ids];
      removedPhotos = [];
      formPhotoList.replaceChildren();
      void renderFormPhotos();
      showPhotoProblem('');
      photosBusy.hidden = true;
    },
    close(saving) {
      formSession += 1;
      // While saving, the photos are being kept: not dropped.
      if (!saving) dropPendingPhotos();
    },
    ids: () => formPhotos,
    inUse: () => [...formPhotos, ...pendingPhotos.keys()],
    ready: () => addingPhotos,
    async save() {
      try {
        await savePhotos([...pendingPhotos.values()]);
      } catch {
        showPhotoProblem('Couldn’t save the photos. Your device may be out of space.');
        addPhotosButton.focus();
        return null;
      }
      const added = [...pendingPhotos.keys()];
      const removed = removedPhotos;
      pendingPhotos.clear();
      void deletePhotos(removed);
      removedPhotos = [];
      return { added, removed };
    },
    pick() {
      photoInput.click();
    },
    remove(id) {
      const index = formPhotos.indexOf(id);
      formPhotos = formPhotos.filter((photo) => photo !== id);
      if (pendingPhotos.delete(id)) void deletePhotos([id]);
      else removedPhotos = [...removedPhotos, id];
      void renderFormPhotos().then(() => {
        // Keep keyboard focus nearby: the next photo's button, or "Add photos".
        const buttons = formPhotoList.querySelectorAll<HTMLElement>('[data-action="remove-photo"]');
        (buttons[Math.min(index, buttons.length - 1)] ?? addPhotosButton).focus();
      });
    },
  };
}
