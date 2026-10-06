import type { Schemas } from "@shkriuss/data";
import { Button } from "@shkriuss/ui";
import { useEffect, useId, useSyncExternalStore } from "react";
import { backupStatusOf } from "./backup-status.ts";
import { m } from "./messages.ts";
import { Restore, type RestoreDatabase } from "./Restore.tsx";
import { type BackupDatabase, useBackupDialog } from "./useBackupDialog.tsx";

export interface BackupSectionProps {
  /** The app's id, which names its backup files (backup format §1), and its own backups. */
  readonly app: string;
  readonly db: BackupDatabase & RestoreDatabase;
  /** Every version of the app's schema, to read backups of older versions (§5.5). */
  readonly schemas: Schemas;
}

/**
 * The part of Settings about backups (backup format §3–§5; architecture §8): when the last
 * backup was made and how much has changed since, a dialog that makes one, and one that restores
 * one.
 */
export function BackupSection({ app, db, schemas }: BackupSectionProps) {
  const headingId = useId();
  const store = backupStatusOf(db);
  const status = useSyncExternalStore(store.subscribe, store.getStatus);
  const backup = useBackupDialog(app, db);

  useEffect(() => {
    // What the device knows about its backups, whenever the section appears.
    void store.refresh();
  }, [store]);

  // Left out until the database says, or if it cannot.
  let text = "";
  const device = status?.device;
  if (device !== undefined) {
    text =
      device.lastBackup === null
        ? m.noBackup()
        : `${m.lastBackup(new Date(device.lastBackup))} ${m.changesSince(device.changesSinceBackup)}`;
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col items-start gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {m.backups()}
      </h2>
      <p className="empty:hidden">{text}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onPress={backup.start}>
          {m.backUp()}
        </Button>
        <Restore
          app={app}
          db={db}
          schemas={schemas}
          onRestored={() => {
            void store.refresh();
          }}
        />
      </div>
      {backup.dialog}
    </section>
  );
}
