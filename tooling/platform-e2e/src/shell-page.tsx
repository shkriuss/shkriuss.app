import "@shkriuss/ui/styles.css";
import {
  type AppStorage,
  type AppUpdates,
  appInstall,
  type StorageStatus,
  type UpdateState,
} from "@shkriuss/pwa";
import {
  AppError,
  AppFrame,
  BackupReminder,
  InstallBanner,
  NotFound,
  Screen,
  ScreenLink,
  SettingsScreen,
  loadSettingsScreen,
  StartFailed,
  useObserved,
} from "@shkriuss/shell";
import { Button } from "@shkriuss/ui";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, useMemo, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { BACKUP_APP } from "./backups.ts";
import { current, failedUpgrade, notesDatabase, SCHEMAS_1, BROKEN_SCHEMAS } from "./data.ts";
import { m } from "./shell-messages.ts";

// The shell of @shkriuss/shell around a screen of notes, at /shell, an archive, at /shell/archive,
// and the settings, at /shell/settings, for the end-to-end tests in e2e/shell.spec.ts. Its routes
// are declared in code, as every app's are (ADR 0013), under /shell. The notes, their backups and
// the reminder to back them up are the data layer's, and installing is the browser's; the update
// state and the storage are the tests' to set.

type NotesDatabase = Awaited<ReturnType<typeof notesDatabase>>;

/** What the end-to-end tests do with the shell's page. */
export interface ShellTests {
  /** Sets the state that the update banner shows. */
  setUpdateState(state: UpdateState): void;
  /** Sets what the update banner says that reloading clears, or that it clears nothing. */
  setReloadWarning(warning: string | undefined): void;
  /** How many times the banner applied an update. */
  applied(): number;
  /** Sets what the storage says. */
  setStorageStatus(status: StorageStatus): void;
  /** Answers the request to keep the data that waits, and says it is kept if `kept`. */
  answerPersistence(kept: boolean): void;
  /** How many times the settings read the storage's status again. */
  storageRefreshes(): number;
}

let updateState: UpdateState = "ready";
let reloadWarning: string | undefined;
let applied = 0;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** A stand-in for the app's service worker, whose state the tests set. */
const updates: AppUpdates = {
  getState: () => updateState,
  subscribe: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  applyUpdate: () => {
    applied += 1;
  },
  checkForUpdate: async () => undefined,
  firstUseKept: async () => false,
  controlled: () => true,
};

let storageStatus: StorageStatus = {
  persistence: "best-effort",
  usage: 1_234_567,
  quota: 10_000_000_000,
};
let storageRefreshes = 0;
let answerRequest: ((kept: boolean) => void) | undefined;
const storageListeners = new Set<() => void>();

function setStorageStatus(status: StorageStatus): void {
  storageStatus = status;
  for (const listener of storageListeners) {
    listener();
  }
}

/** A stand-in for the app's storage, whose status and answers the tests set. */
const storage: AppStorage = {
  getStatus: () => storageStatus,
  subscribe: (listener) => {
    storageListeners.add(listener);
    return () => {
      storageListeners.delete(listener);
    };
  },
  refresh: async () => {
    storageRefreshes += 1;
  },
  requestPersistenceQuietly: async () => {
    // The tests set the status by hand.
  },
  requestPersistence: async () =>
    new Promise<boolean>((resolve) => {
      answerRequest = (kept) => {
        if (kept) {
          setStorageStatus({ ...storageStatus, persistence: "persisted" });
        }
        resolve(kept);
      };
    }),
};

export const shell: ShellTests = {
  setUpdateState(state) {
    updateState = state;
    changed();
  },
  setReloadWarning(warning) {
    reloadWarning = warning;
    changed();
  },
  applied: () => applied,
  setStorageStatus,
  answerPersistence(kept) {
    if (answerRequest === undefined) {
      throw new Error("Nothing asked the browser to keep the data.");
    }
    answerRequest(kept);
    answerRequest = undefined;
  },
  storageRefreshes: () => storageRefreshes,
};

function Notes({ db }: { readonly db: NotesDatabase }) {
  const notes = useObserved(
    useMemo(
      () =>
        db.observe(async (reader) =>
          (await reader.list("notes")).map(({ values }) => values.title).toSorted(),
        ),
      [db],
    ),
  );
  const [broken, setBroken] = useState(false);
  if (broken) {
    throw new Error("The test broke this screen.");
  }
  let content;
  if (notes.state === "loading") {
    content = <p>{m.loading()}</p>;
  } else if (notes.state === "failed") {
    content = <p>{m.failed()}</p>;
  } else if (notes.value.length === 0) {
    content = <p>{m.empty()}</p>;
  } else {
    content = (
      <ul className="list-disc ps-6">
        {notes.value.map((title) => (
          <li key={title}>{title}</li>
        ))}
      </ul>
    );
  }
  return (
    <Screen title={m.notes()}>
      <div className="flex flex-col items-start gap-4">
        {content}
        <Button
          onPress={() => {
            setBroken(true);
          }}
        >
          {m.breakScreen()}
        </Button>
      </div>
    </Screen>
  );
}

function Archive() {
  return (
    <Screen title={m.archive()}>
      <p>{m.archiveEmpty()}</p>
    </Screen>
  );
}

function Settings({ db }: { readonly db: NotesDatabase }) {
  return (
    <SettingsScreen
      app={BACKUP_APP}
      name={m.app()}
      description={m.description()}
      db={db}
      schemas={current().schemas}
      install={appInstall()}
      storage={storage}
    />
  );
}

function Root({ db }: { readonly db: NotesDatabase }) {
  const warning = useSyncExternalStore(updates.subscribe, () => reloadWarning);
  return (
    <AppFrame
      name={m.app()}
      updates={updates}
      navigation={<ScreenLink to="/archive">{m.archive()}</ScreenLink>}
      banners={
        <>
          <InstallBanner install={appInstall()} db={db} />
          <BackupReminder app={BACKUP_APP} db={db} />
        </>
      }
      reloadWarning={warning}
    >
      <Outlet />
    </AppFrame>
  );
}

/** The routes of the shell's page, in code (ADR 0013), under /shell. */
function shellRouter(db: NotesDatabase) {
  const root = createRootRoute({ component: () => <Root db={db} /> });
  const notes = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <Notes db={db} />,
  });
  const archive = createRoute({ getParentRoute: () => root, path: "/archive", component: Archive });
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings",
    loader: loadSettingsScreen,
    component: () => <Settings db={db} />,
  });
  return createRouter({
    routeTree: root.addChildren([notes, archive, settings]),
    basepath: "/shell",
    defaultErrorComponent: AppError,
    defaultNotFoundComponent: NotFound,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof shellRouter>;
  }
}

export async function showShellPage(): Promise<void> {
  // Before anything waits, as every app does when it starts: the browser offers to install the
  // app once the page has loaded, and the tests stand in for it.
  appInstall();
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  // The router shows a screen that fails; nothing reads a console here.
  const root = createRoot(container, { onCaughtError: () => undefined });
  // At /shell?upgrade=broken, the page is a version of the app whose upgrade fails.
  if (new URLSearchParams(location.search).get("upgrade") === "broken") {
    const error = await failedUpgrade();
    root.render(
      <StrictMode>
        <StartFailed name={m.app()} app={BACKUP_APP} schemas={BROKEN_SCHEMAS} error={error} />
      </StrictMode>,
    );
    return;
  }
  // As every app with data starts (tooling/app-template/src/main.tsx).
  try {
    const router = shellRouter(await notesDatabase());
    root.render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
  } catch (error) {
    root.render(
      <StrictMode>
        <StartFailed name={m.app()} app={BACKUP_APP} schemas={SCHEMAS_1} error={error} />
      </StrictMode>,
    );
  }
}
