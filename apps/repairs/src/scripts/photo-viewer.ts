/**
 * Repairs: looking at a repair's photos one at a time (the photos on this
 * device), and saving a copy of one. Split from repairs.ts (audit J-7).
 */
import { downloadFile } from '@shkriuss/storage';
import { required } from '@shkriuss/ui/dom';
import {
  dateLabel,
  photoCopyName,
  vehicleName,
  type Repair,
  type VehiclesState,
} from '../lib/repairs.ts';
import { getPhoto, thumbUrl } from './photos.ts';

export interface PhotoViewer {
  /** Opens the photo viewer on one of a repair's photos. */
  open(repair: Repair, id: string): Promise<void>;
  /** The previous (-1) or next (1) photo, going round. */
  step(by: number): void;
  /** "Save a copy": the photo as a file, named after the repair. */
  saveCopy(): Promise<void>;
}

export function mountPhotoViewer(root: ParentNode, vehicles: () => VehiclesState): PhotoViewer {
  const photoDialog = required<HTMLDialogElement>(root, '[data-photo-dialog]');
  const photoTitle = required<HTMLElement>(photoDialog, '[data-photo-title]');
  const photoImage = required<HTMLImageElement>(photoDialog, '[data-photo-image]');
  const photoSaid = required<HTMLElement>(photoDialog, '[data-photo-said]');
  const savePhotoButton = required<HTMLElement>(photoDialog, '[data-action="save-photo"]');

  /** The photo being looked at: its repair, the photos on this device, which one. */
  let viewing: { repair: Repair; ids: string[]; index: number; url: string | null } | null = null;

  /** Shows the photo `viewing` is on; `say`: reads out which it is (focus is on Next or Previous). */
  async function showPhoto(say = false): Promise<void> {
    if (!viewing) return;
    const { repair, ids, index } = viewing;
    const photo = await getPhoto(ids[index] ?? '');
    if (!viewing || viewing.index !== index) return;
    if (viewing.url) URL.revokeObjectURL(viewing.url);
    viewing.url = photo ? URL.createObjectURL(photo.blob) : null;
    photoImage.src = viewing.url ?? '';
    // Only the full photo can be saved: without a connection, it's the thumbnail here.
    savePhotoButton.hidden = !photo?.full;
    const what = `the repair on ${vehicleName(vehicles(), repair.vehicle)} on ${dateLabel(repair.date)}`;
    photoTitle.textContent = ids.length === 1 ? 'Photo' : `Photo ${index + 1} of ${ids.length}`;
    photoImage.alt =
      ids.length === 1 ? `From ${what}` : `${index + 1} of ${ids.length}, from ${what}`;
    // Next and Previous said nothing of the photo they showed (audit 3 G-8).
    if (say) photoSaid.textContent = photoTitle.textContent;
  }

  photoDialog.addEventListener('close', () => {
    if (viewing?.url) URL.revokeObjectURL(viewing.url);
    viewing = null;
    photoImage.removeAttribute('src');
    // Empty, so the same words are read out again next time.
    photoSaid.textContent = '';
  });

  return {
    async open(repair, id) {
      const urls = await Promise.all(repair.photos.map(thumbUrl));
      const ids = repair.photos.filter((_, index) => urls[index]);
      viewing = { repair, ids, index: Math.max(0, ids.indexOf(id)), url: null };
      for (const action of ['previous-photo', 'next-photo']) {
        required<HTMLElement>(photoDialog, `[data-action="${action}"]`).hidden = ids.length < 2;
      }
      await showPhoto();
      photoDialog.showModal();
      // Focus starts on which photo it is, not on "Previous", where Enter would
      // show another one (audit G-14).
      photoTitle.focus();
    },
    step(by) {
      if (!viewing) return;
      viewing.index = (viewing.index + by + viewing.ids.length) % viewing.ids.length;
      void showPhoto(true);
    },
    async saveCopy() {
      if (!viewing) return;
      const { repair, ids, index } = viewing;
      const photo = await getPhoto(ids[index] ?? '');
      if (!photo?.full) return;
      // Kept for a minute, as every download is: Safari on an iPhone asks
      // first, and fetches the file only then (audit 6 C-2).
      downloadFile(
        photoCopyName(vehicleName(vehicles(), repair.vehicle), repair.date, index + 1),
        photo.blob,
      );
    },
  };
}
