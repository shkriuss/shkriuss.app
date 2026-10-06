import "@shkriuss/ui/styles.css";
import { openDatabase } from "@shkriuss/data";
import { appInstall, appStorage, startServiceWorker } from "@shkriuss/pwa";
import { StartFailed, appUpdates } from "@shkriuss/shell";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { m } from "./messages.ts";
import { createAppRouter } from "./router.ts";
import { schemas } from "./schema.ts";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("index.html has no #root element.");
}

// Before anything waits: the browser offers to install the app once the page has loaded.
const install = appInstall();
const updates = appUpdates(startServiceWorker());
const root = createRoot(container);
try {
  // A newer version of the app, in another window, may close the database later.
  const db = await openDatabase(schemas, { onVersionChange: updates.databaseClosed });
  const router = createAppRouter({ db, updates, install, storage: appStorage() });
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
} catch (error) {
  root.render(
    <StrictMode>
      <StartFailed name={m.appName()} error={error} />
    </StrictMode>,
  );
}
