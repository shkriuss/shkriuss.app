/**
 * For edit forms in apps that sync. A form shows an item as it was when it
 * opened; while it's open, a sync may bring another device's changes to the
 * same item. Saving the whole form would put the old values back, so only
 * what the person changed in the form is put on the item as it is now.
 */

/**
 * `current` (the item now, as form values) with the fields the person
 * changed: those that differ between `opened` (the form when it opened) and
 * `edited` (the form now). Other fields keep `current`'s values.
 */
export function withEdits<T extends object>(opened: T, edited: T, current: T): T {
  const result: T = { ...current };
  for (const key of changedFields(opened, edited)) result[key] = edited[key];
  return result;
}

/**
 * Whether the person changed anything in the form. An item deleted on another
 * device while its form was open comes back only with a change, so saving a
 * form left as it was doesn't undo the deletion everywhere (audit 4 F1-3).
 */
export const hasEdits = <T extends object>(opened: T, edited: T): boolean =>
  changedFields(opened, edited).length > 0;

/** The fields that differ between `opened` and `edited`. */
const changedFields = <T extends object>(opened: T, edited: T): (keyof T)[] =>
  (Object.keys(edited) as (keyof T)[]).filter(
    (key) => JSON.stringify(edited[key]) !== JSON.stringify(opened[key]),
  );
