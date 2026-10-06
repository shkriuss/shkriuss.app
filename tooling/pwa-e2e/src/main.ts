// The test app of @shkriuss/pwa, never deployed: each build starts the service worker and tells
// the tests which build the page runs, on window.pwaTest.
import { startServiceWorker } from "@shkriuss/pwa";

/** The build's name, from vite.config.ts. */
declare const PWA_E2E_BUILD: string;

declare global {
  interface Window {
    pwaTest?: {
      readonly build: string;
      readonly updates: ReturnType<typeof startServiceWorker>;
      /** Loads the lazily loaded chunk, which says which build it belongs to. */
      loadLazy(): Promise<string>;
    };
  }
}

window.pwaTest = {
  build: PWA_E2E_BUILD,
  updates: startServiceWorker(),
  loadLazy: async () => (await import("./lazy.ts")).lazy,
};
