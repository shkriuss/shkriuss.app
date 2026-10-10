import {
  BackupError,
  createBackupFile,
  generatePassphrase,
  isEasyToGuess,
  isLongEnough,
} from "@shkriuss/backup";
import { Button, Dialog, TextField } from "@shkriuss/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { backupStatusOf } from "./backup-status.ts";
import { browserSaveEnvironment } from "./browser.ts";
import { m } from "./data-messages.ts";
import { samePassphrase } from "./passphrases.ts";
import { saveFile } from "./save.ts";
import type { BackupDatabase, BackupMaker } from "./useBackupDialog.tsx";

function hasDeviceState(db: BackupMaker): db is BackupDatabase {
  return db.device !== undefined;
}

/** The step that offers to save the backup that was made. */
interface Ready {
  readonly name: "ready";
  readonly file: File;
  /** When its latest change is dated, if that is more than a day ahead (data model §3.5). */
  readonly fromFuture: number | undefined;
  /** The changes that its snapshot had, which the database records once it is saved. */
  readonly counted: number;
  readonly notSaved: boolean;
  readonly saving: boolean;
}

/**
 * Where the dialog that makes a backup stands. Only the steps that show the generated passphrase,
 * or lead back to it, keep it: once the backup is made, the page lets go of it (backup format
 * §3.1).
 */
type Step =
  | { readonly name: "closed" }
  | { readonly name: "generated"; readonly generated: string }
  | { readonly name: "own"; readonly generated: string }
  | { readonly name: "plain"; readonly generated: string }
  | { readonly name: "making" }
  | Ready
  | { readonly name: "saved"; readonly file: File; readonly shared: boolean }
  | { readonly name: "failed"; readonly tooLarge: boolean; readonly generated: string };

function Actions({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

/**
 * What keeps the user's own passphrase from being used: the first field's is too short or easy
 * to guess (backup format §3.1), or the second field's differs. Each failed attempt gives a new
 * one.
 */
type PassphraseProblem =
  | { readonly field: "first"; readonly reason: "too-short" | "easy-to-guess" }
  | { readonly field: "second" };

/**
 * The form for a passphrase that the user picks and types twice (backup format §3.1). It checks
 * the passphrase when the user presses "Back up", and an error goes as soon as the user edits its
 * field: the layout moves while the user types, never while they press. An error that went with
 * the focus, as the browser's own checks do, would move the button from under the pointer.
 */
function OwnPassphrase({
  onBackUp,
  onGenerated,
  onCancel,
}: {
  readonly onBackUp: (passphrase: string) => void;
  readonly onGenerated: () => void;
  readonly onCancel: () => void;
}) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [problem, setProblem] = useState<PassphraseProblem | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const secondInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // After an attempt that failed, the focus goes to the field to correct.
    if (problem?.field === "first") {
      firstInput.current?.focus();
    } else if (problem?.field === "second") {
      secondInput.current?.focus();
    }
  }, [problem]);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        let found: PassphraseProblem | null = null;
        if (!isLongEnough(first)) {
          found = { field: "first", reason: "too-short" };
        } else if (isEasyToGuess(first)) {
          found = { field: "first", reason: "easy-to-guess" };
        } else if (!samePassphrase(first, second)) {
          found = { field: "second" };
        }
        setProblem(found);
        if (found === null) {
          onBackUp(first);
        }
      }}
    >
      <p>{m.ownText()}</p>
      <TextField
        label={m.passphrase()}
        type="password"
        autoComplete="new-password"
        isRequired
        validationBehavior="aria"
        value={first}
        onChange={(value) => {
          setFirst(value);
          setProblem(null);
        }}
        isInvalid={problem?.field === "first"}
        errorMessage={
          problem?.field === "first" && problem.reason === "easy-to-guess"
            ? m.easyToGuess()
            : m.tooShort()
        }
        inputRef={firstInput}
      />
      <TextField
        label={m.passphraseAgain()}
        type="password"
        autoComplete="new-password"
        isRequired
        validationBehavior="aria"
        value={second}
        onChange={(value) => {
          setSecond(value);
          setProblem((current) => (current?.field === "second" ? null : current));
        }}
        isInvalid={problem?.field === "second"}
        errorMessage={m.different()}
        inputRef={secondInput}
      />
      <Actions>
        <Button type="submit" variant="primary">
          {m.backUp()}
        </Button>
        <Button onPress={onGenerated}>{m.chooseGenerated()}</Button>
        <Button onPress={onCancel}>{m.cancel()}</Button>
      </Actions>
    </form>
  );
}

export interface BackupDialogProps {
  /** The app's id, which names its backup files (backup format §1). */
  readonly app: string;
  readonly db: BackupMaker;
  /** Called when the dialog closes, if the browser could not give the focus back. */
  readonly onFocusLost?: (() => void) | undefined;
  /** Called once the dialog has closed, after the browser gave the focus back if it could. */
  readonly onClosed: () => void;
}

/**
 * The dialog that `useBackupDialog()` opens, with a new generated passphrase, from the moment it
 * is shown. It loads on demand, with the code that makes backups.
 */
export function BackupDialog({ app, db, onFocusLost, onClosed }: BackupDialogProps) {
  // A new passphrase for each backup.
  const [step, setStep] = useState<Step>(() => ({
    name: "generated",
    generated: generatePassphrase(),
  }));
  const content = useRef<HTMLDivElement>(null);
  // What the dialog started last, so that only its result shows: a backup that was being made
  // when the user closed the dialog, or made another, never appears, and its worker stops.
  const work = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    // A step that replaces another takes the focus, so that it is not lost with a button that
    // went away, and screen readers read the new step.
    if (step.name !== "closed") {
      content.current?.focus();
    }
  }, [step.name]);

  const close = (): void => {
    work.current?.abort();
    work.current = undefined;
    setStep({ name: "closed" });
  };

  /**
   * Makes the backup, encrypted with `passphrase`, or plain without one. `generated` is the
   * generated passphrase, which the dialog offers again if making the backup failed.
   */
  async function make(passphrase: string | null, generated: string): Promise<void> {
    work.current?.abort();
    const controller = new AbortController();
    work.current = controller;
    const { signal } = controller;
    setStep({ name: "making" });
    let next: Step;
    try {
      const { file, fromFuture, counted } = await createBackupFile(db, {
        app,
        passphrase,
        signal,
      });
      next = { name: "ready", file, fromFuture, counted, notSaved: false, saving: false };
    } catch (error) {
      next = {
        name: "failed",
        tooLarge: error instanceof BackupError && error.code === "too-large",
        generated,
      };
    }
    if (!signal.aborted) {
      setStep(next);
    }
  }

  async function save(ready: Ready): Promise<void> {
    const current = work.current;
    const { file } = ready;
    // Called while the user's press still counts, as the share sheet needs: setting the step
    // only schedules a render.
    setStep({ ...ready, notSaved: false, saving: true });
    const result = await saveFile(file, browserSaveEnvironment());
    if (result !== "cancelled") {
      try {
        await db.recordBackup(ready.counted);
      } catch {
        // The file is saved all the same; only the reminders do not know of it.
      }
      if (hasDeviceState(db)) {
        await backupStatusOf(db).refresh();
      }
    }
    if (current === work.current) {
      setStep(
        result === "cancelled"
          ? { ...ready, notSaved: true, saving: false }
          : { name: "saved", file, shared: result === "shared" },
      );
    }
  }

  let title = m.backUpTitle();
  let body: ReactNode = null;
  switch (step.name) {
    case "closed":
      break;
    case "generated": {
      const { generated } = step;
      body = (
        <>
          <p>{m.generatedText()}</p>
          <p className="rounded-lg bg-surface p-3 font-mono text-lg break-words select-all">
            {generated}
          </p>
          <Actions>
            <Button
              variant="primary"
              onPress={() => {
                void make(generated, generated);
              }}
            >
              {m.backUp()}
            </Button>
            <Button
              onPress={() => {
                setStep({ name: "own", generated });
              }}
            >
              {m.chooseOwn()}
            </Button>
            <Button onPress={close}>{m.cancel()}</Button>
          </Actions>
          <Actions>
            <Button
              onPress={() => {
                setStep({ name: "plain", generated });
              }}
            >
              {m.plainInstead()}
            </Button>
          </Actions>
        </>
      );
      break;
    }
    case "own": {
      const { generated } = step;
      title = m.ownTitle();
      body = (
        <OwnPassphrase
          onBackUp={(passphrase) => {
            void make(passphrase, generated);
          }}
          onGenerated={() => {
            setStep({ name: "generated", generated });
          }}
          onCancel={close}
        />
      );
      break;
    }
    case "plain": {
      const { generated } = step;
      title = m.plainTitle();
      body = (
        <>
          <p>{m.plainText()}</p>
          <Actions>
            <Button
              variant="danger"
              onPress={() => {
                void make(null, generated);
              }}
            >
              {m.makePlain()}
            </Button>
            <Button onPress={close}>{m.cancel()}</Button>
          </Actions>
        </>
      );
      break;
    }
    case "making":
      title = m.makingTitle();
      body = <p>{m.making()}</p>;
      break;
    case "ready": {
      const { fromFuture, notSaved, saving } = step;
      title = m.readyTitle();
      body = (
        <>
          <p>{m.readyText()}</p>
          {fromFuture === undefined ? null : <p>{m.readyFromFuture(new Date(fromFuture))}</p>}
          {/* An <output>, whose role is status: screen readers read it when it changes. */}
          <output className="block empty:hidden">{notSaved ? m.notSaved() : ""}</output>
          <Actions>
            <Button
              variant="primary"
              isPending={saving}
              onPress={() => {
                void save(step);
              }}
            >
              {m.save()}
            </Button>
            <Button onPress={close}>{m.cancel()}</Button>
          </Actions>
        </>
      );
      break;
    }
    case "saved":
      title = m.savedTitle();
      body = (
        <>
          <p>
            {step.shared ? m.shared() : m.downloaded(step.file.name)} {m.keepElsewhere()}
          </p>
          <Actions>
            <Button variant="primary" onPress={close}>
              {m.done()}
            </Button>
          </Actions>
        </>
      );
      break;
    case "failed": {
      const { tooLarge, generated } = step;
      title = m.failedTitle();
      body = (
        <>
          <p>{tooLarge ? m.tooLarge() : m.failed()}</p>
          <Actions>
            {tooLarge ? null : (
              <Button
                variant="primary"
                onPress={() => {
                  setStep({ name: "generated", generated });
                }}
              >
                {m.tryAgain()}
              </Button>
            )}
            <Button onPress={close}>{m.cancel()}</Button>
          </Actions>
        </>
      );
      break;
    }
  }

  return (
    <Dialog
      isOpen={step.name !== "closed"}
      onClose={() => {
        // The dialog has closed, by a button of its own or by Escape, and the browser gave the
        // focus back if it could. If not, the focus is nowhere, or still in the closed dialog
        // until the browser takes it away.
        const focused = document.activeElement;
        const lost =
          focused === null ||
          focused === document.body ||
          content.current?.contains(focused) === true;
        close();
        if (lost) {
          onFocusLost?.();
        }
        onClosed();
      }}
      title={title}
    >
      <div ref={content} tabIndex={-1} className="flex flex-col gap-4 outline-none">
        {body}
      </div>
    </Dialog>
  );
}
