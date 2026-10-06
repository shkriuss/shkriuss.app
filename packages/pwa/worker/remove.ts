// The /sw.js of a build that turns service workers off (docs/specs/service-worker.md §9): it
// removes the service worker and its caches from every device that has them.
import { removeApp } from "./worker.ts";

declare const self: ServiceWorkerGlobalScope;

removeApp(self);
