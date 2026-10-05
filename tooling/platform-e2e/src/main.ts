import { registerServiceWorker, startWorker } from "@shkriuss/edge/workers";
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
    };
  }
}

window.platform = { pingWorker, startWorker, registerServiceWorker, data };
