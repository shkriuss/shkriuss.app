import { use } from "react";
import { FrameContext } from "./frame.ts";
import { m } from "./messages.ts";
import { Screen } from "./Screen.tsx";
import { ScreenLink } from "./ScreenLink.tsx";

/**
 * What the app shows at an address that none of its screens has, such as an old bookmark: that
 * the page does not exist, and a link to the app's first screen. The router shows it in place of
 * a screen, as its `defaultNotFoundComponent`.
 */
export function NotFound() {
  const { name } = use(FrameContext);
  return (
    <Screen title={m.notFoundTitle()}>
      <p>{m.notFoundText()}</p>
      <p>
        <ScreenLink to="/">{m.goHome(name)}</ScreenLink>
      </p>
    </Screen>
  );
}
