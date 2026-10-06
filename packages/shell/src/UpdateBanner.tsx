import type { AppUpdates, UpdateState } from "@shkriuss/pwa";
import { Banner, Button } from "@shkriuss/ui";
import { useState, useSyncExternalStore } from "react";
import { m } from "./messages.ts";

export interface UpdateBannerProps {
  /** The app's service worker, from `startServiceWorker()`. */
  readonly updates: AppUpdates;
}

/**
 * Tells the user that a new version of the app is ready, and updates it when they agree
 * (service worker spec §7.2). It never interrupts: "Later" hides it until there is news again.
 */
export function UpdateBanner({ updates }: UpdateBannerProps) {
  const state = useSyncExternalStore(updates.subscribe, updates.getState);
  const [dismissed, setDismissed] = useState<UpdateState>();
  if (state === dismissed) {
    return null;
  }
  const later = (
    <Button
      onPress={() => {
        setDismissed(state);
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
        {m.updateAvailable()}
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
        {m.outdated()}
      </Banner>
    );
  }
  // Unavailable, installing or ready: nothing to say.
  return null;
}
