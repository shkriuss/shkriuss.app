import { Banner, Button } from "@shkriuss/ui";
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { FrameContext } from "./frame.ts";
import { backupStatusOf } from "./backup-status.ts";
import { m } from "./messages.ts";
import { LATER, reminderFor } from "./reminder.ts";
import { type BackupDatabase, useBackupDialog } from "./useBackupDialog.tsx";

export interface BackupReminderProps {
  /** The app's id, which names its backup files (backup format §1). */
  readonly app: string;
  readonly db: BackupDatabase;
}

/**
 * Reminds the user to back up (architecture §8), in the frame's banners: when the device has
 * changes that none of its backups has, and it never made a backup, or made its last one a week
 * ago or more. "Back up" opens the backup dialog at once; "Later" hides the reminder for a day.
 *
 * It checks when the app opens and whenever it comes back into view, never in the middle of a
 * task: a change does not bring it, though a backup, made here or in the settings, takes it away.
 */
export function BackupReminder({ app, db }: BackupReminderProps) {
  const store = backupStatusOf(db);
  const status = useSyncExternalStore(store.subscribe, store.getStatus);
  const { focusScreen } = useContext(FrameContext);
  // Whether the latest check found the reminder due: only a check brings it.
  const [due, setDue] = useState(false);
  // Until when "Later" hides it, in milliseconds since 1970.
  const later = useRef(Number.NEGATIVE_INFINITY);
  // After a backup, the reminder is gone, and with it the button that the focus would go back to:
  // the focus goes to the screen.
  const backup = useBackupDialog(app, db, focusScreen);

  useEffect(() => {
    let mounted = true;
    async function check(): Promise<void> {
      await store.refresh();
      const checked = store.getStatus();
      if (mounted && checked?.device !== undefined) {
        setDue(
          checked.at >= later.current && reminderFor(checked.device, checked.at) !== undefined,
        );
      }
    }
    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        void check();
      }
    }
    void check();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [store]);

  const reminder =
    due && status?.device !== undefined ? reminderFor(status.device, status.at) : undefined;
  return (
    <>
      {reminder === undefined ? null : (
        <Banner
          actions={
            <>
              <Button variant="primary" onPress={backup.start}>
                {m.backUp()}
              </Button>
              <Button
                onPress={() => {
                  later.current = Date.now() + LATER;
                  setDue(false);
                  // The banner goes, and with it the button that has the focus.
                  focusScreen();
                }}
              >
                {m.later()}
              </Button>
            </>
          }
        >
          {reminder.kind === "first"
            ? m.remindFirst()
            : m.remindDue(new Date(reminder.lastBackup), reminder.changes)}
        </Banner>
      )}
      {/* The dialog stays when the reminder goes, as after a backup, and is no part of the banner,
          whose changes screen readers read. */}
      {createPortal(backup.dialog, document.body)}
    </>
  );
}
