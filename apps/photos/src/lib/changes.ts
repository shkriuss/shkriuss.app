/**
 * Whether another Photos tab changed the library on this device (audit
 * finding J-3). Loading the library reads, checks and sorts every photo,
 * which takes seconds with a big library, too slow to do each time Photos
 * gets focus. So every change counts one more in a number every tab can
 * see (localStorage), and a tab loads the library again only when that
 * number isn't the one it last saw.
 */
import { createStore, type StorageLike } from '@shkriuss/storage';

export const CHANGES = {
  key: 'photos-changes',
  version: 1,
  fallback: () => 0,
  validate: (value: unknown): value is number => Number.isSafeInteger(value),
};

export function changeCount(storage?: StorageLike) {
  const count = createStore({ ...CHANGES, storage });
  let seen = count.load();
  return {
    /** This tab is about to load the library, so it will have every change so far. */
    loading(): void {
      seen = count.load();
    },
    /** This tab changed the library. */
    changed(): void {
      seen = count.load() + 1;
      count.save(seen);
    },
    /**
     * Another tab changed the library since this one last loaded or changed
     * it. Always true when the number can't be kept (storage blocked), so
     * nothing is ever missed.
     */
    changedElsewhere: (): boolean => count.load() !== seen,
  };
}
