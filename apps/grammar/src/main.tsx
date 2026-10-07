import "@shkriuss/ui/styles.css";
import { appInstall, startServiceWorker } from "@shkriuss/pwa";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createChecker } from "./features/check/checker.ts";
import { startWorkerCheck } from "./features/check/worker-check.ts";
import { createAppRouter } from "./router.ts";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html has no #root element.");
}

// The app keeps no data, so it has no database to open: it starts the install prompt, which
// the browser offers once the page has loaded, and the service worker, then shows its screens.
// The checker starts once the service worker keeps the app for offline use.
const updates = startServiceWorker();
const router = createAppRouter({
  updates,
  install: appInstall(),
  checker: createChecker(updates, startWorkerCheck),
});
createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
