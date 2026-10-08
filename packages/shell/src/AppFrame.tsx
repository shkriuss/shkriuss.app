import type { AppUpdates } from "@shkriuss/pwa";
import type { ReactNode } from "react";
import { Frame } from "./Frame.tsx";
import { m } from "./messages.ts";
import { ScreenLink } from "./ScreenLink.tsx";
import { UpdateBanner } from "./UpdateBanner.tsx";

export interface AppFrameProps {
  /** The app's name, at the top of every screen and in the page's title. */
  readonly name: string;
  /** The app's service worker, from `startServiceWorker()`, for the update banner. */
  readonly updates: AppUpdates;
  /** Links to the app's main screens, as `<ScreenLink>`s, before the link to the settings. */
  readonly navigation?: ReactNode;
  /** Banners under the update banner, such as `<BackupReminder>`. */
  readonly banners?: ReactNode;
  /**
   * What reloading the page clears, for an app that keeps something only in the page, such as a
   * text: the update banner says it while it offers to update, which reloads the page.
   */
  readonly reloadWarning?: string | undefined;
  /** The screen: the router's `<Outlet />`. */
  readonly children: ReactNode;
}

/**
 * The frame of every app's screens, which the app's root route shows: the shell's `Frame`, with
 * the app's name, which leads to its first screen, and its navigation, which ends with the
 * settings; the update banner and the others; and the screen as the page's main content. When
 * the user comes to another screen, its heading takes the focus.
 */
export function AppFrame({
  name,
  updates,
  navigation,
  banners,
  reloadWarning,
  children,
}: AppFrameProps) {
  return (
    <Frame
      name={name}
      navigation={
        <>
          {navigation}
          <ScreenLink to="/settings">{m.settings()}</ScreenLink>
        </>
      }
      banners={
        <>
          <UpdateBanner updates={updates} reloadWarning={reloadWarning} />
          {banners}
        </>
      }
    >
      {children}
    </Frame>
  );
}
