/**
 * Repairs: looking at a repair's photos one at a time (the photos on this
 * device), and saving a copy of one. Split from repairs.ts (audit J-7).
 */
import { required } from '@shkriuss/ui/dom';
import { dateLabel, vehicleName, type Repair, type VehiclesState } from '../lib/repairs.ts';
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
  const savePhotoButton = required<HTMLElement>(photoDialog, '[data-action="save-photo"]');

  /** The photo being looked at: its repair, the photos on this device, which one. */
  let viewing: { repair: Repair; ids: string[]; index: number; url: string | null } | null = null;

  async function showPhoto(): Promise<void> {
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
  }

  photoDialog.addEventListener('close', () => {
    if (viewing?.url) URL.revokeObjectURL(viewing.url);
    viewing = null;
    photoImage.removeAttribute('src');
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
    },
    step(by) {
      if (!viewing) return;
      viewing.index = (viewing.index + by + viewing.ids.length) % viewing.ids.length;
      void showPhoto();
    },
    async saveCopy() {
      if (!viewing) return;
      const { repair, ids, index } = viewing;
      const photo = await getPhoto(ids[index] ?? '');
      if (!photo?.full) return;
      const name = `${vehicleName(vehicles(), repair.vehicle)}-${repair.date}-photo-${index + 1}`
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-');
      const url = URL.createObjectURL(photo.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${name}.jpg`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}
