import "@shkriuss/ui/styles.css";
import { deviceLocale } from "@shkriuss/i18n";
import { appInstall, startServiceWorker } from "@shkriuss/pwa";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createChecker } from "./features/check/checker.ts";
import { createDraftStore } from "./features/check/draft.ts";
import { varietyOf } from "./features/check/variety.ts";
import { startWorkerCheck } from "./features/check/worker-check.ts";
import { createAppRouter } from "./router.ts";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html has no #root element.");
}

// The app keeps no data, so it has no database to open: it starts the install prompt, which
// the browser offers once the page has loaded, and the service worker, then shows its screens.
// The checker starts once the service worker keeps the app for offline use. The text, in the
// variety of the browser's language until the user picks another, stays while the page does.
const updates = startServiceWorker();
const router = createAppRouter({
  updates,
  install: appInstall(),
  checker: createChecker(updates, startWorkerCheck),
  draft: createDraftStore(varietyOf(deviceLocale())),
});
createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
