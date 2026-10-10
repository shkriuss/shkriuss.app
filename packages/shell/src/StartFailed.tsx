import { DataLayerError, isStorageFull, rescueSnapshot, type Schemas } from "@shkriuss/data";
import { Button } from "@shkriuss/ui";
import { useMemo } from "react";
import { type Frame, FrameContext } from "./frame.ts";
import { m } from "./data-messages.ts";
import { Screen } from "./Screen.tsx";
import { type BackupMaker, useBackupDialog } from "./useBackupDialog.tsx";

export interface StartFailedProps {
  /** The app's name, for the page's title. */
  readonly name: string;
  /** The app's id, which names its backup files (backup format §1). */
  readonly app: string;
  /** Every version of the app's schema, to read the data at the version that the device has. */
  readonly schemas: Schemas;
  /** Why the app could not start: what `openDatabase()` of `@shkriuss/data` rejected with. */
  readonly error: unknown;
}

/**
 * What the app shows in place of its frame when it cannot open its database: that a newer
 * version of the app has opened it already, which reloading brings (data model §7), or that it
 * could not be opened, and a way to load the app again. Then it also offers a backup of the data
 * as the device stores it, which a version of the app that works can restore (backup format §4).
 * The error's details stay in the app.
 */
export function StartFailed({ name, app, schemas, error }: StartFailedProps) {
  const frame = useMemo<Frame>(() => ({ name, focusScreen: () => undefined }), [name]);
  // Nothing records this backup: the database stays as it is.
  const rescue = useMemo<BackupMaker>(
    () => ({
      snapshot: async () => rescueSnapshot(schemas),
      recordBackup: async () => undefined,
    }),
    [schemas],
  );
  const backup = useBackupDialog(app, rescue);
  const outdated = error instanceof DataLayerError && error.code === "newer-version";
  let text = m.startFailedText();
  if (outdated) {
    text = m.startOutdatedText();
  } else if (isStorageFull(error)) {
    text = m.startStorageFullText();
  }
  return (
    <FrameContext value={frame}>
      <main className="page">
        <Screen title={outdated ? m.startOutdatedTitle() : m.startFailedTitle()}>
          <p>{text}</p>
          {outdated ? null : <p>{m.startRescueText()}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onPress={() => {
                location.reload();
              }}
            >
              {m.reload()}
            </Button>
            {outdated ? null : <Button onPress={backup.start}>{m.backUp()}</Button>}
          </div>
          {backup.dialog}
        </Screen>
      </main>
    </FrameContext>
  );
}
