import { Button } from "@shkriuss/ui";
import { useMemo } from "react";
import { type Frame, FrameContext } from "./frame.ts";
import { m } from "./data-messages.ts";
import { Screen } from "./Screen.tsx";

export interface StartBlockedProps {
  /** The app's name, for the page's title. */
  readonly name: string;
}

/**
 * What the app shows in place of its frame while another window or tab, with an older version
 * of the app, keeps its database from upgrading (data model §7): `openDatabase()` of
 * `@shkriuss/data` calls `onBlocked` then, and waits. The other window closes the database by
 * itself as soon as it can, and the app then starts; one that cannot, as a frozen page, needs
 * the user to close it, which this screen asks for, with a way to load the app again.
 */
export function StartBlocked({ name }: StartBlockedProps) {
  const frame = useMemo<Frame>(() => ({ name, focusScreen: () => undefined }), [name]);
  return (
    <FrameContext value={frame}>
      <main className="page">
        <Screen title={m.startBlockedTitle()}>
          <p>{m.startBlockedText()}</p>
          <div>
            <Button
              variant="primary"
              onPress={() => {
                location.reload();
              }}
            >
              {m.reload()}
            </Button>
          </div>
        </Screen>
      </main>
    </FrameContext>
  );
}
