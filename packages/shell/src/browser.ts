import type { SaveEnvironment } from "./save.ts";

// What the shell uses of the browser's globals. The end-to-end tests cover it; the unit tests
// cover the logic that uses it, with fakes.

/** How long a downloaded file's URL stays valid, so that the browser can start the download. */
const DOWNLOAD_URL_LIFETIME = 60_000;

/** The browser's way to save a file. */
export function browserSaveEnvironment(): SaveEnvironment {
  return {
    canShare: "canShare" in navigator ? navigator.canShare.bind(navigator) : undefined,
    share: "share" in navigator ? navigator.share.bind(navigator) : undefined,
    download: (file) => {
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, DOWNLOAD_URL_LIFETIME);
    },
  };
}
