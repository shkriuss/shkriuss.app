import type { AppInstall } from "@shkriuss/pwa";
import { Banner, Button } from "@shkriuss/ui";
import { useContext, useState, useSyncExternalStore } from "react";
import { backupStatusOf, type DeviceReader } from "./backup-status.ts";
import { FrameContext } from "./frame.ts";
import { m } from "./messages.ts";
import { useStatusChecks } from "./useStatusChecks.ts";

export interface InstallBannerProps {
  /** How the app installs, from `appInstall()` of `@shkriuss/pwa`. */
  readonly install: AppInstall;
  /** The app's database, to know whether the user has entered anything yet. */
  readonly db: DeviceReader;
}

/**
 * Suggests installing the app before the user enters anything, in the frame's banners, on iPhone
 * and iPad (architecture §9): there, the app on the Home Screen keeps its own data, apart from
 * the browser's, and the browser may delete a site's data after a week without a visit. Once the
 * device has data, the settings say how to take it along instead.
 *
 * Like the backup reminder, it checks when the app opens and whenever it comes back into view;
 * "Later" hides it until the app opens again.
 */
export function InstallBanner({ install, db }: InstallBannerProps) {
  const state = useSyncExternalStore(install.subscribe, install.getState);
  const store = backupStatusOf(db);
  const { focusScreen } = useContext(FrameContext);
  const [due, setDue] = useState(false);

  useStatusChecks(store, ({ device }) => {
    setDue(
      install.getState() === "add-to-home-screen" &&
        device !== undefined &&
        device.lastBackup === null &&
        device.changesSinceBackup === 0,
    );
  });

  if (!due || state !== "add-to-home-screen") {
    return null;
  }
  return (
    <Banner
      actions={
        <Button
          onPress={() => {
            setDue(false);
            // The banner goes, and with it the button that has the focus.
            focusScreen();
          }}
        >
          {m.later()}
        </Button>
      }
    >
      {m.installFirst()}
    </Banner>
  );
}
