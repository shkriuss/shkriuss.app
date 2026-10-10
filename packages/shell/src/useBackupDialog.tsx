import type { DeviceState, Snapshot } from "@shkriuss/data";
import { type ReactNode, Suspense, useRef, useState } from "react";
import { BackupDialog as LaterBackupDialog } from "./on-demand.tsx";

/** What making a backup uses of the app's database, from `openDatabase()` of `@shkriuss/data`. */
export interface BackupDatabase {
  snapshot(): Promise<Snapshot>;
  device(): Promise<DeviceState>;
  recordBackup(counted: number): Promise<void>;
}

/**
 * What the backup dialog uses of the database: its snapshot and recording the backup, and the
 * device's state, which the reminders follow, where it has one. A backup of the data as stored,
 * when the app cannot open it, has none (backup format §4).
 */
export type BackupMaker = Pick<BackupDatabase, "snapshot" | "recordBackup"> &
  Partial<Pick<BackupDatabase, "device">>;

/** The dialog that makes a backup, and what opens it. */
export interface BackupDialog {
  /** Opens the dialog, with a new generated passphrase. */
  readonly start: () => void;
  /** The dialog, for the component to render. */
  readonly dialog: ReactNode;
}

/**
 * The dialog that makes a backup (backup format §3, §4; architecture §8), for the backup section
 * of the settings and for the reminder. A backup is encrypted with a generated passphrase, which
 * the user writes down, or with one the user picks and types twice. A plain backup comes only
 * after a warning. Once the file is ready, "Save backup" hands it to the share sheet where the
 * browser can share it, or downloads it, and the database records the backup, which every part
 * of the shell that shows the backup status then shows.
 *
 * When the dialog closes, the browser gives the focus back to what had it before, such as the
 * button that opened it. `onFocusLost` is called if it cannot, as when that button went away.
 *
 * The dialog, with the code that makes backups, loads when the user first opens it: the first
 * page does without it (ADR 0018).
 */
export function useBackupDialog(
  app: string,
  db: BackupMaker,
  onFocusLost?: () => void,
): BackupDialog {
  // Each opening shows a dialog of its own, with a new passphrase: an earlier dialog that closes
  // late, as when the user opens the next at once, closes only itself.
  const openings = useRef(0);
  const [shown, setShown] = useState<number | null>(null);
  return {
    start: () => {
      openings.current += 1;
      setShown(openings.current);
    },
    dialog:
      shown === null ? null : (
        <Suspense fallback={null}>
          <LaterBackupDialog
            key={shown}
            app={app}
            db={db}
            onFocusLost={onFocusLost}
            onClosed={() => {
              setShown((current) => (current === shown ? null : current));
            }}
          />
        </Suspense>
      ),
  };
}
