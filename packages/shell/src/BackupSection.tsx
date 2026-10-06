import { BackupError, createBackupFile, generatePassphrase, isLongEnough } from "@shkriuss/backup";
import type { DeviceState, Schemas, Snapshot } from "@shkriuss/data";
import { Button, Dialog, TextField } from "@shkriuss/ui";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { browserSaveEnvironment } from "./browser.ts";
import { m } from "./messages.ts";
import { samePassphrase } from "./passphrases.ts";
import { Restore, type RestoreDatabase } from "./Restore.tsx";
import { saveFile } from "./save.ts";

/** What backups use of the app's database, from `openDatabase()` of `@shkriuss/data`. */
export interface BackupDatabase extends RestoreDatabase {
  snapshot(): Promise<Snapshot>;
  device(): Promise<DeviceState>;
  recordBackup(): Promise<void>;
}

export interface BackupSectionProps {
  /** The app's id, which names its backup files (backup format §1), and its own backups. */
  readonly app: string;
  readonly db: BackupDatabase;
  /** Every version of the app's schema, to read backups of older versions (§5.5). */
  readonly schemas: Schemas;
}

/** Where the dialog that makes a backup stands. */
type Step =
  | { readonly name: "closed" }
  | { readonly name: "generated" }
  | { readonly name: "own" }
  | { readonly name: "plain" }
  | { readonly name: "making" }
  | {
      readonly name: "ready";
      readonly file: File;
      readonly notSaved: boolean;
      readonly saving: boolean;
    }
  | { readonly name: "saved"; readonly file: File; readonly shared: boolean }
  | { readonly name: "failed"; readonly tooLarge: boolean };

/**
 * What the device knows about its backups; `undefined` if the database cannot say, and the
 * section then only leaves out when the last backup was made.
 */
async function deviceState(db: BackupDatabase): Promise<DeviceState | undefined> {
  try {
    return await db.device();
  } catch {
    return undefined;
  }
}

function Actions({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

/**
 * What keeps the user's own passphrase from being used: the first field's is too short, or the
 * second field's differs. Each failed attempt gives a new one.
 */
interface PassphraseProblem {
  readonly field: "first" | "second";
}

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
          found = { field: "first" };
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
        errorMessage={m.tooShort()}
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

/**
 * The part of Settings about backups (backup format §3–§5; architecture §8): when the last
 * backup was made and how much has changed since, a dialog that makes one, and one that restores
 * one.
 *
 * A backup is encrypted with a generated passphrase, which the user writes down, or with one
 * the user picks and types twice. A plain backup comes only after a warning. Once the file is
 * ready, "Save backup" hands it to the share sheet where the browser can share it, or downloads
 * it, and the database records the backup.
 */
export function BackupSection({ app, db, schemas }: BackupSectionProps) {
  const [device, setDevice] = useState<DeviceState>();
  const [step, setStep] = useState<Step>({ name: "closed" });
  const [generated, setGenerated] = useState("");
  const headingId = useId();
  const content = useRef<HTMLDivElement>(null);
  // Counts what the dialog started, so that only the latest shows its result: a backup that was
  // being made when the user closed the dialog, or made another, never appears.
  const work = useRef(0);

  useEffect(() => {
    // What the device knows about its backups, whenever the section appears.
    let shown = true;
    void (async () => {
      const state = await deviceState(db);
      if (shown) {
        setDevice(state);
      }
    })();
    return () => {
      shown = false;
    };
  }, [db]);

  useEffect(() => {
    // A step that replaces another takes the focus, so that it is not lost with a button that
    // went away, and screen readers read the new step.
    if (step.name !== "closed") {
      content.current?.focus();
    }
  }, [step.name]);

  const close = (): void => {
    work.current += 1;
    // The passphrase stays in memory only while the dialog needs it (backup format §3.1).
    setGenerated("");
    setStep({ name: "closed" });
  };

  async function make(passphrase: string | null): Promise<void> {
    work.current += 1;
    const id = work.current;
    setStep({ name: "making" });
    let next: Step;
    try {
      next = {
        name: "ready",
        file: await createBackupFile(db, { app, passphrase }),
        notSaved: false,
        saving: false,
      };
    } catch (error) {
      next = {
        name: "failed",
        tooLarge: error instanceof BackupError && error.code === "too-large",
      };
    }
    if (id === work.current) {
      setStep(next);
    }
  }

  async function save(file: File): Promise<void> {
    const id = work.current;
    // Called while the user's press still counts, as the share sheet needs: setting the step
    // only schedules a render.
    setStep({ name: "ready", file, notSaved: false, saving: true });
    const result = await saveFile(file, browserSaveEnvironment());
    if (result !== "cancelled") {
      try {
        await db.recordBackup();
      } catch {
        // The file is saved all the same; only the reminders do not know of it.
      }
      setDevice(await deviceState(db));
    }
    if (id === work.current) {
      setStep(
        result === "cancelled"
          ? { name: "ready", file, notSaved: true, saving: false }
          : { name: "saved", file, shared: result === "shared" },
      );
    }
  }

  let title = m.backUpTitle();
  let body: ReactNode = null;
  switch (step.name) {
    case "closed":
      break;
    case "generated":
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
                void make(generated);
              }}
            >
              {m.backUp()}
            </Button>
            <Button
              onPress={() => {
                setStep({ name: "own" });
              }}
            >
              {m.chooseOwn()}
            </Button>
            <Button onPress={close}>{m.cancel()}</Button>
          </Actions>
          <Actions>
            <Button
              onPress={() => {
                setStep({ name: "plain" });
              }}
            >
              {m.plainInstead()}
            </Button>
          </Actions>
        </>
      );
      break;
    case "own":
      title = m.ownTitle();
      body = (
        <OwnPassphrase
          onBackUp={(passphrase) => {
            void make(passphrase);
          }}
          onGenerated={() => {
            setStep({ name: "generated" });
          }}
          onCancel={close}
        />
      );
      break;
    case "plain":
      title = m.plainTitle();
      body = (
        <>
          <p>{m.plainText()}</p>
          <Actions>
            <Button
              variant="danger"
              onPress={() => {
                void make(null);
              }}
            >
              {m.makePlain()}
            </Button>
            <Button onPress={close}>{m.cancel()}</Button>
          </Actions>
        </>
      );
      break;
    case "making":
      title = m.makingTitle();
      body = <p>{m.making()}</p>;
      break;
    case "ready": {
      const { file, notSaved, saving } = step;
      title = m.readyTitle();
      body = (
        <>
          <p>{m.readyText()}</p>
          {/* An <output>, whose role is status: screen readers read it when it changes. */}
          <output className="block empty:hidden">{notSaved ? m.notSaved() : ""}</output>
          <Actions>
            <Button
              variant="primary"
              isPending={saving}
              onPress={() => {
                void save(file);
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
    case "failed":
      title = m.failedTitle();
      body = (
        <>
          <p>{step.tooLarge ? m.tooLarge() : m.failed()}</p>
          <Actions>
            {step.tooLarge ? null : (
              <Button
                variant="primary"
                onPress={() => {
                  setStep({ name: "generated" });
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

  let status = "";
  if (device !== undefined) {
    status =
      device.lastBackup === null
        ? m.noBackup()
        : `${m.lastBackup(new Date(device.lastBackup))} ${m.changesSince(device.changesSinceBackup)}`;
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col items-start gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {m.backups()}
      </h2>
      <p className="empty:hidden">{status}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onPress={() => {
            // A new passphrase for each backup.
            setGenerated(generatePassphrase());
            setStep({ name: "generated" });
          }}
        >
          {m.backUp()}
        </Button>
        <Restore
          app={app}
          db={db}
          schemas={schemas}
          onRestored={() => {
            void (async () => {
              setDevice(await deviceState(db));
            })();
          }}
        />
      </div>
      <Dialog isOpen={step.name !== "closed"} onClose={close} title={title}>
        <div ref={content} tabIndex={-1} className="flex flex-col gap-4 outline-none">
          {body}
        </div>
      </Dialog>
    </section>
  );
}
