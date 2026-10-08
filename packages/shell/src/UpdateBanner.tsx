import type { AppUpdates, UpdateState } from "@shkriuss/pwa";
import { Banner, Button } from "@shkriuss/ui";
import { useContext, useState, useSyncExternalStore } from "react";
import { FrameContext } from "./frame.ts";
import { m } from "./messages.ts";

export interface UpdateBannerProps {
  /** The app's service worker, from `startServiceWorker()`. */
  readonly updates: AppUpdates;
  /**
   * What reloading the page clears, which the banner adds while it offers to update or to
   * reload: for an app that keeps something only in the page, such as a text.
   */
  readonly reloadWarning?: string | undefined;
}

/** The banner's text, and after it what reloading clears, if anything. */
function withWarning(text: string, warning: string | undefined): string {
  return warning === undefined ? text : `${text} ${warning}`;
}

/**
 * Tells the user that a new version of the app is ready, and updates it when they agree
 * (service worker spec §7.2). It never interrupts: "Later" hides it until there is news again.
 */
export function UpdateBanner({ updates, reloadWarning }: UpdateBannerProps) {
  const state = useSyncExternalStore(updates.subscribe, updates.getState);
  const [dismissed, setDismissed] = useState<UpdateState>();
  const { focusScreen } = useContext(FrameContext);
  if (state === dismissed) {
    return null;
  }
  const later = (
    <Button
      onPress={() => {
        setDismissed(state);
        // The banner goes, and with it the button that has the focus.
        focusScreen();
      }}
    >
      {m.later()}
    </Button>
  );
  if (state === "update-available") {
    return (
      <Banner
        actions={
          <>
            <Button variant="primary" onPress={updates.applyUpdate}>
              {m.update()}
            </Button>
            {later}
          </>
        }
      >
        {withWarning(m.updateAvailable(), reloadWarning)}
      </Banner>
    );
  }
  if (state === "updating") {
    return <Banner>{m.updating()}</Banner>;
  }
  if (state === "outdated") {
    return (
      <Banner
        actions={
          <>
            <Button variant="primary" onPress={updates.applyUpdate}>
              {m.reload()}
            </Button>
            {later}
          </>
        }
      >
        {withWarning(m.outdated(), reloadWarning)}
      </Banner>
    );
  }
  // Unavailable, installing or ready: nothing to say.
  return null;
}
