import "@shkriuss/ui/styles.css";
import type { AppStorage, AppUpdates, StorageStatus, UpdateState } from "@shkriuss/pwa";
import {
  AppErrorBoundary,
  AppFrame,
  BackupReminder,
  BackupSection,
  StorageSection,
  useObserved,
} from "@shkriuss/shell";
import { Button, Link } from "@shkriuss/ui";
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BACKUP_APP } from "./backups.ts";
import { current, notesDatabase } from "./data.ts";
import { m } from "./shell-messages.ts";

// The shell of @shkriuss/shell around a screen of notes, at /shell, and around the settings, at
// /shell/settings, for the end-to-end tests in e2e/shell.spec.ts. The notes, their backups and the
// reminder to back them up are the data layer's; the update state and the storage are the tests'
// to set.

type NotesDatabase = Awaited<ReturnType<typeof notesDatabase>>;

/** What the end-to-end tests do with the shell's page. */
export interface ShellTests {
  /** Sets the state that the update banner shows. */
  setUpdateState(state: UpdateState): void;
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
let applied = 0;
const listeners = new Set<() => void>();

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
    for (const listener of listeners) {
      listener();
    }
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
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-2xl font-semibold">{m.notes()}</h1>
      {content}
      <Button
        onPress={() => {
          setBroken(true);
        }}
      >
        {m.breakScreen()}
      </Button>
    </div>
  );
}

function Settings({ db }: { readonly db: NotesDatabase }) {
  const { schemas } = current();
  return (
    <div className="flex flex-col items-start gap-6">
      <h1 className="text-2xl font-semibold">{m.settings()}</h1>
      <StorageSection storage={storage} />
      <BackupSection app={BACKUP_APP} db={db} schemas={schemas} />
    </div>
  );
}

export async function showShellPage(): Promise<void> {
  const db = await notesDatabase();
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  // The error boundary shows a screen that fails; nothing reads a console here.
  createRoot(container, { onCaughtError: () => undefined }).render(
    <StrictMode>
      <AppFrame
        name={m.app()}
        updates={updates}
        banners={<BackupReminder app={BACKUP_APP} db={db} />}
        navigation={
          <>
            <Link href="/shell">{m.notes()}</Link>
            <Link href="/shell/settings">{m.settings()}</Link>
          </>
        }
      >
        <AppErrorBoundary>
          {location.pathname === "/shell/settings" ? <Settings db={db} /> : <Notes db={db} />}
        </AppErrorBoundary>
      </AppFrame>
    </StrictMode>,
  );
}
