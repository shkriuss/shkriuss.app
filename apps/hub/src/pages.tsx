import { Screen, ScreenLink } from "@shkriuss/shell/site";
import { Button } from "@shkriuss/ui";
import { m } from "./messages.ts";

/** What the hub shows at an address that it has no page for, with a link to the apps. */
export function NotFoundPage() {
  return (
    <Screen title={m.notFoundTitle()}>
      <p>{m.notFoundText()}</p>
      <p>
        <ScreenLink to="/">{m.toApps()}</ScreenLink>
      </p>
    </Screen>
  );
}

/** What the hub shows in the frame when a page fails, such as when its chunk was refused. */
export function ErrorPage() {
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
