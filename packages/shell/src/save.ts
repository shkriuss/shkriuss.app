/**
 * How a backup file leaves the app (backup format §4, architecture §8): the share sheet where
 * the browser can share the file, so that the user can put it in Files, Google Drive or iCloud
 * Drive, or a download.
 *
 * Browsers decide which files they share, and `navigator.canShare()` says so: Chrome, for one,
 * shares only some types, which leave out `.age` and `.json` files, so it downloads backups.
 */

/** What saving a file uses of the browser. */
export interface SaveEnvironment {
  /** `navigator.canShare`, where the browser has the Web Share API. */
  readonly canShare: ((data: ShareData) => boolean) | undefined;
  /** `navigator.share`, where the browser has the Web Share API. */
  readonly share: ((data: ShareData) => Promise<void>) | undefined;
  /** Downloads the file. */
  readonly download: (file: File) => void;
}

/**
 * - `shared`: the user chose where the file goes in the share sheet;
 * - `downloaded`: the browser downloads the file;
 * - `cancelled`: the user closed the share sheet without sharing; nothing was saved.
 */
export type SaveResult = "shared" | "downloaded" | "cancelled";

/**
 * Hands `file` over: to the share sheet if the browser can share it, otherwise as a download.
 * Call it while the user's press of a button still counts, as the share sheet needs.
 */
export async function saveFile(file: File, environment: SaveEnvironment): Promise<SaveResult> {
  const { canShare, share, download } = environment;
  const data: ShareData = { files: [file] };
  if (canShare?.(data) === true && share !== undefined) {
    try {
      await share(data);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      // The browser refused to share after all, as without the user's press: download instead.
    }
  }
  download(file);
  return "downloaded";
}
