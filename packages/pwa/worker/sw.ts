// The service worker of an app (docs/specs/service-worker.md). The build bundles this file into
// /sw.js, one classic script, and puts the data of its version in place of the placeholder.
import type { BuildData } from "../src/protocol.ts";
import { serveApp } from "./worker.ts";

declare const self: ServiceWorkerGlobalScope;
declare const SHKRIUSS_PWA_BUILD: BuildData;

serveApp(self, SHKRIUSS_PWA_BUILD);
