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
// The checker starts once there is text, or at once in an installed app or once its module is
// kept (ADR 0019). The text, in the variety of the browser's language until the user picks
// another, stays while the page does.
const updates = startServiceWorker();
const install = appInstall();
const router = createAppRouter({
  updates,
  install,
  checker: createChecker({
    updates,
    install,
    start: startWorkerCheck,
    onOnline: (listener) => {
      window.addEventListener("online", listener);
    },
    webAssembly: typeof WebAssembly === "object",
  }),
  draft: createDraftStore(varietyOf(deviceLocale())),
});
createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
