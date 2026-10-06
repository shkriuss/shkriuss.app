import { DataLayerError } from "@shkriuss/data";
import { Button } from "@shkriuss/ui";
import { useMemo } from "react";
import { type Frame, FrameContext } from "./frame.ts";
import { m } from "./messages.ts";
import { Screen } from "./Screen.tsx";

export interface StartFailedProps {
  /** The app's name, for the page's title. */
  readonly name: string;
  /** Why the app could not start: what `openDatabase()` of `@shkriuss/data` rejected with. */
  readonly error: unknown;
}

/**
 * What the app shows in place of its frame when it cannot open its database: that a newer
 * version of the app has opened it already, which reloading brings (data model §7), or that it
 * could not be opened, and a way to load the app again. The error's details stay in the app.
 */
export function StartFailed({ name, error }: StartFailedProps) {
  const frame = useMemo<Frame>(() => ({ name, focusScreen: () => undefined }), [name]);
  const outdated = error instanceof DataLayerError && error.code === "newer-version";
  return (
    <FrameContext value={frame}>
      <main className="page">
        <Screen title={outdated ? m.startOutdatedTitle() : m.startFailedTitle()}>
          <p>{outdated ? m.startOutdatedText() : m.startFailedText()}</p>
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
