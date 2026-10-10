import { DataLayerError, isStorageFull } from "@shkriuss/data";
import { m } from "../../messages.ts";

/** What the app says of a write that failed, besides that the device has no space left. */
export interface WriteFailureTexts {
  /** When it failed for a reason that the app cannot name: a reload may help. */
  readonly otherwise: string;
  /**
   * When the record was deleted meanwhile, in another window or on another device (data model
   * §4.2), if the write was to a record; a write that creates one has no such case.
   */
  readonly deleted?: string;
}

/**
 * What the app says when a write failed: that the device has no space left for the data, which
 * the user can do something about (data model §7); that the record was deleted meanwhile, so
 * that no reload is needed; or `otherwise`.
 */
export function writeFailure(error: unknown, texts: WriteFailureTexts): string {
  if (isStorageFull(error)) {
    return m.storageFull();
  }
  if (texts.deleted !== undefined && error instanceof DataLayerError && error.code === "deleted") {
    return texts.deleted;
  }
  return texts.otherwise;
}

/** A failure that a screen shows: what it says, and the item that it concerns, if one. */
export interface ItemFailure {
  readonly message: string;
  readonly item?: string;
}

/**
 * The failure to keep showing among `items`, as the screen observes them: none once the item
 * that it concerns is gone from them, as after it was deleted in another window; the screen
 * shows that for itself.
 */
export function failureShownWith(
  failure: ItemFailure | undefined,
  items: readonly { readonly id: string }[],
): ItemFailure | undefined {
  const item = failure?.item;
  if (item !== undefined && !items.some(({ id }) => id === item)) {
    return undefined;
  }
  return failure;
}
