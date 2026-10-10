import {
  BackupError,
  type BackupContents,
  type OpenedFile,
  openBackupFile,
  readBackupFile,
} from "@shkriuss/backup";
import type {
  ImportOptions,
  ImportPreview,
  ImportSummary,
  Incoming,
  Schemas,
} from "@shkriuss/data";
import { Button, Dialog, FileButton, TextField } from "@shkriuss/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { m } from "./data-messages.ts";
import { restoreErrorMessage } from "./restore-errors.ts";
import { stopOnUnmount } from "./work.ts";

/** What restoring uses of the app's database, from `openDatabase()` of `@shkriuss/data`. */
export interface RestoreDatabase {
  previewImport(incoming: Incoming): Promise<ImportPreview>;
  import(incoming: Incoming, options?: ImportOptions): Promise<ImportSummary>;
}

export interface RestoreProps {
  /** The app's id: only its own backups restore (backup format §5.4). */
  readonly app: string;
  readonly db: RestoreDatabase;
  /** Every version of the app's schema, to read backups of older versions (§5.5). */
  readonly schemas: Schemas;
  /** Called once a restore wrote to the database. */
  readonly onRestored: () => void;
}

/** Where the dialog that restores a backup stands. */
type Step =
  | { readonly name: "closed" }
  | { readonly name: "reading" }
  | { readonly name: "passphrase"; readonly file: OpenedFile; readonly wrong: boolean }
  | {
      readonly name: "preview";
      readonly contents: BackupContents;
      readonly summary: ImportPreview;
    }
  | { readonly name: "restoring" }
  | { readonly name: "restored"; readonly summary: ImportSummary }
  | { readonly name: "failed"; readonly message: string };

function Actions({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

/**
 * The form for the passphrase of an encrypted backup (§5.2). After a wrong one, it says so and
 * the user tries again; an error goes as soon as the user edits the field, so that nothing
 * moves while they press "Open".
 */
function Passphrase({
  wrong,
  onOpen,
  onCancel,
}: {
  readonly wrong: boolean;
  readonly onOpen: (passphrase: string) => void;
  readonly onCancel: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState(wrong ? m.wrongPassphrase() : "");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // The field takes the focus, also after a wrong passphrase, so that the user types at once.
    input.current?.focus();
  }, []);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (passphrase === "") {
          setError(m.enterPassphrase());
          input.current?.focus();
          return;
        }
        onOpen(passphrase);
      }}
    >
      <p>{m.encryptedText()}</p>
      <TextField
        label={m.passphrase()}
        type="password"
        autoComplete="current-password"
        isRequired
        validationBehavior="aria"
        value={passphrase}
        onChange={(value) => {
          setPassphrase(value);
          setError("");
        }}
        isInvalid={error !== ""}
        errorMessage={error}
        inputRef={input}
      />
      <Actions>
        <Button type="submit" variant="primary">
          {m.open()}
        </Button>
        <Button onPress={onCancel}>{m.cancel()}</Button>
      </Actions>
    </form>
  );
}

/**
 * Restores a backup that the user picks (backup format §5): it opens the file, asks for the
 * passphrase if the file is encrypted, reads and checks it, and shows what restoring it would
 * do, and when its changes are dated more than a day ahead of this device's clock (data model
 * §3.5); only when the user agrees does it write, in one transaction. A failure at any step says
 * why (§6), and changes nothing.
 */
export function Restore({ app, db, schemas, onRestored }: RestoreProps) {
  const [step, setStep] = useState<Step>({ name: "closed" });
  const content = useRef<HTMLDivElement>(null);
  // What the dialog started last: only its result shows, and closing the dialog, or starting
  // anything else, stops it, with the worker that decrypts the file.
  const work = useRef<AbortController | undefined>(undefined);

  /** Starts new work, and stops the one before; its signal says when it is no longer wanted. */
  const begin = (): AbortSignal => {
    work.current?.abort();
    const controller = new AbortController();
    work.current = controller;
    return controller.signal;
  };

  useEffect(() => {
    // A step that replaces another takes the focus, so that it is not lost with a button that
    // went away; the passphrase's field takes it itself.
    if (step.name !== "closed" && step.name !== "passphrase") {
      content.current?.focus();
    }
  }, [step.name]);

  // The dialog went away without closing, as when the user navigates elsewhere: the work stops.
  useEffect(() => stopOnUnmount(work), []);

  const close = (): void => {
    work.current?.abort();
    work.current = undefined;
    setStep({ name: "closed" });
  };

  async function read(file: OpenedFile, passphrase: string | null): Promise<void> {
    const signal = begin();
    setStep({ name: "reading" });
    let next: Step;
    try {
      const contents = await readBackupFile(file, passphrase, { app, schemas, signal });
      next = { name: "preview", contents, summary: await db.previewImport(contents.incoming) };
    } catch (error) {
      next =
        error instanceof BackupError && error.code === "wrong-passphrase"
          ? { name: "passphrase", file, wrong: true }
          : { name: "failed", message: restoreErrorMessage(error) };
    }
    if (!signal.aborted) {
      setStep(next);
    }
  }

  async function restoreFrom(picked: File): Promise<void> {
    const signal = begin();
    setStep({ name: "reading" });
    let file: OpenedFile;
    try {
      file = await openBackupFile(picked);
    } catch (error) {
      if (!signal.aborted) {
        setStep({ name: "failed", message: restoreErrorMessage(error) });
      }
      return;
    }
    if (signal.aborted) {
      return;
    }
    if (file.encrypted) {
      setStep({ name: "passphrase", file, wrong: false });
    } else {
      await read(file, null);
    }
  }

  /** Imports the backup; `acceptFromFuture` once the user has confirmed its dates (§5.6). */
  async function apply(contents: BackupContents, acceptFromFuture: boolean): Promise<void> {
    const signal = begin();
    setStep({ name: "restoring" });
    let next: Step;
    try {
      next = {
        name: "restored",
        summary: await db.import(contents.incoming, { acceptFromFuture }),
      };
      onRestored();
    } catch (error) {
      next = { name: "failed", message: restoreErrorMessage(error) };
    }
    if (!signal.aborted) {
      setStep(next);
    }
  }

  let title = m.readingTitle();
  let body: ReactNode = null;
  switch (step.name) {
    case "closed":
      break;
    case "reading":
      body = (
        <>
          <p>{m.reading()}</p>
          <Actions>
            {/* Escape closes the dialog too, but a phone has no Escape key. */}
            <Button onPress={close}>{m.cancel()}</Button>
          </Actions>
        </>
      );
      break;
    case "passphrase": {
      const { file, wrong } = step;
      title = m.encryptedTitle();
      body = (
        <Passphrase
          wrong={wrong}
          onOpen={(passphrase) => {
            void read(file, passphrase);
          }}
          onCancel={close}
        />
      );
      break;
    }
    case "preview": {
      const { contents, summary } = step;
      const { total, fromFuture, writes } = summary;
      const changes = total.new + total.updated + total.deleted;
      // Dates from the future matter only to a restore that writes something.
      const ahead = writes === 0 ? undefined : fromFuture;
      let brings = m.brings(total);
      if (changes === 0) {
        // Deletions that change nothing the app shows are still worth keeping (§5.6).
        brings = writes === 0 ? m.nothingNew() : m.onlyDeletions();
      }
      title = m.previewTitle();
      body = (
        <>
          <p>{m.madeOn(contents.exported)}</p>
          <p>{brings}</p>
          {ahead === undefined ? null : <p>{m.restoreFromFuture(new Date(ahead))}</p>}
          <Actions>
            {writes === 0 ? null : (
              <Button
                variant="primary"
                onPress={() => {
                  void apply(contents, ahead !== undefined);
                }}
              >
                {ahead === undefined ? m.restoreNow() : m.restoreAnyway()}
              </Button>
            )}
            <Button onPress={close}>{writes === 0 ? m.close() : m.cancel()}</Button>
          </Actions>
        </>
      );
      break;
    }
    case "restoring":
      title = m.restoringTitle();
      body = <p>{m.restoring()}</p>;
      break;
    case "restored": {
      const { total } = step.summary;
      title = m.restoredTitle();
      body = (
        <>
          <p>
            {total.new + total.updated + total.deleted === 0
              ? m.restoredNothingShown()
              : m.restored(total)}
          </p>
          <Actions>
            <Button variant="primary" onPress={close}>
              {m.done()}
            </Button>
          </Actions>
        </>
      );
      break;
    }
    case "failed":
      title = m.notRestoredTitle();
      body = (
        <>
          <p>{step.message}</p>
          <Actions>
            <Button variant="primary" onPress={close}>
              {m.close()}
            </Button>
          </Actions>
        </>
      );
      break;
  }

  return (
    <>
      <FileButton
        onSelect={(picked) => {
          void restoreFrom(picked);
        }}
      >
        {m.restore()}
      </FileButton>
      <Dialog
        isOpen={step.name !== "closed"}
        // An import that has started commits: the dialog stays until it says so (§5.7).
        isDismissable={step.name !== "restoring"}
        onClose={close}
        title={title}
      >
        <div ref={content} tabIndex={-1} className="flex flex-col gap-4 outline-none">
          {body}
        </div>
      </Dialog>
    </>
  );
}
