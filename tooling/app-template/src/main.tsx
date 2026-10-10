import "@shkriuss/ui/styles.css";
import { openDatabase } from "@shkriuss/data";
import { appInstall, appStorage, startServiceWorker } from "@shkriuss/pwa";
import { StartFailed, appUpdates } from "@shkriuss/shell";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { config } from "../app.config.ts";
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

/**
 * Opens the database, then shows the app, or why it could not start. A function rather than a
 * top-level await, which would turn off the build's chunk optimizations: the code that the
 * settings share with the first page would then go into a chunk that the first page imports
 * statically, which Safari refuses (ADR 0010).
 */
async function start(): Promise<void> {
  try {
    // A newer version of the app, in another window, may close the database later.
    const db = await openDatabase(schemas, { onVersionChange: updates.databaseClosed });
    const storage = appStorage();
    // Chromium and Safari keep the data once they agree, which they decide by themselves.
    void storage.requestPersistenceQuietly();
    const router = createAppRouter({ db, updates, install, storage });
    root.render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
  } catch (error) {
    root.render(
      <StrictMode>
        <StartFailed name={m.appName()} app={config.id} schemas={schemas} error={error} />
      </StrictMode>,
    );
  }
}

void start();
