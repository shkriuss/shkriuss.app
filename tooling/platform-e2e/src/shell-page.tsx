import "@shkriuss/ui/styles.css";
import type { AppUpdates, UpdateState } from "@shkriuss/pwa";
import { AppErrorBoundary, AppFrame, useObserved } from "@shkriuss/shell";
import { Button, Link } from "@shkriuss/ui";
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { notesDatabase } from "./data.ts";
import { m } from "./shell-messages.ts";

// The shell of @shkriuss/shell around a screen of notes, for the end-to-end tests in
// e2e/shell.spec.ts. The notes are the data layer's; the update state is the tests' to set.

type NotesDatabase = Awaited<ReturnType<typeof notesDatabase>>;

/** What the end-to-end tests do with the shell's page. */
export interface ShellTests {
  /** Sets the state that the update banner shows. */
  setUpdateState(state: UpdateState): void;
  /** How many times the banner applied an update. */
  applied(): number;
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

export const shell: ShellTests = {
  setUpdateState(state) {
    updateState = state;
    for (const listener of listeners) {
      listener();
    }
  },
  applied: () => applied,
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
        navigation={
          <>
            <Link href="/shell">{m.notes()}</Link>
            <Link href="/shell#settings">{m.settings()}</Link>
          </>
        }
      >
        <AppErrorBoundary>
          <Notes db={db} />
        </AppErrorBoundary>
      </AppFrame>
    </StrictMode>,
  );
}
