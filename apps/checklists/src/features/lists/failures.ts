import { isStorageFull } from "@shkriuss/data";
import { m } from "../../messages.ts";

/**
 * What the app says when a write failed: that the device has no space left for the data, which
 * the user can do something about (data model §7), or `otherwise`.
 */
export function writeFailure(error: unknown, otherwise: string): string {
  return isStorageFull(error) ? m.storageFull() : otherwise;
}
