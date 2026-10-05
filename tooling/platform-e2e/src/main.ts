import { registerServiceWorker, startWorker } from "@shkriuss/edge/workers";
import { createFormat } from "@shkriuss/i18n";
import { type BackupTests, backups } from "./backups.ts";
import { type DataTests, data } from "./data.ts";
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
};
