import { registerServiceWorker, startWorker } from "@shkriuss/edge/workers";
import { createFormat } from "@shkriuss/i18n";
import { type BackupTests, backups } from "./backups.ts";
import { type DataTests, data } from "./data.ts";
import { showGallery } from "./gallery.tsx";
import { type ShellTests, shell, showShellPage } from "./shell-page.tsx";
import pingWorker from "./ping.worker.ts?worker&url";

declare global {
  interface Window {
    /** What the end-to-end tests use. This app is never deployed. */
    platform?: {
      readonly pingWorker: string;
      readonly startWorker: typeof startWorker;
      readonly registerServiceWorker: typeof registerServiceWorker;
      readonly data: DataTests;
      readonly backups: BackupTests;
      readonly createFormat: typeof createFormat;
      readonly shell: ShellTests;
    };
  }
}

window.platform = {
  pingWorker,
  startWorker,
  registerServiceWorker,
  data,
  backups,
  createFormat,
  shell,
};

// The components page. React is in the entry script, as in every app, so that the helpers that
// Rolldown adds for its CommonJS modules are there too (ADR 0010).
if (location.pathname === "/ui") {
  showGallery();
}

// The shell's page, around a screen of notes.
if (location.pathname === "/shell") {
  void showShellPage();
}
