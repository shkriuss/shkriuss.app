import { Button } from "@shkriuss/ui";
import { m } from "./messages.ts";
import { Screen } from "./Screen.tsx";

/**
 * What a screen shows when it fails, such as when a file of an older version is gone (service
 * worker spec §11): that something went wrong, and a way to load the app again. The router shows
 * it in place of the screen, as its `defaultErrorComponent`, so the frame stays, with the update
 * banner: a new version may well fix the error. The error's details stay in the app.
 */
export function AppError() {
  return (
    <Screen title={m.errorTitle()}>
      <p>{m.errorText()}</p>
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
  );
}
