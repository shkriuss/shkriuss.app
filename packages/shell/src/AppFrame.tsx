import type { AppUpdates } from "@shkriuss/pwa";
import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { type Frame, FrameContext } from "./frame.ts";
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
  /** The screen: the router's `<Outlet />`. */
  readonly children: ReactNode;
}

/**
 * The frame of every app's screens, which the app's root route shows: a header with the app's
 * name, which leads to its first screen, and its navigation, which ends with the settings; the
 * update banner and the others; and the screen as the page's main content. A link that keyboard
 * users reach first skips to the screen (WCAG 2.4.1). When the user comes to another screen, its
 * heading takes the focus.
 */
export function AppFrame({ name, updates, navigation, banners, children }: AppFrameProps) {
  const main = useRef<HTMLElement>(null);
  const router = useRouter();
  const frame = useMemo<Frame>(
    () => ({
      name,
      focusScreen: () => {
        // Where the user is: a banner that goes away is at the top, above the screen.
        main.current?.focus({ preventScroll: true });
      },
    }),
    [name],
  );
  useEffect(
    () =>
      // As a page that loads, another screen starts with its heading, which screen readers
      // then read (WCAG 2.4.3). The router has scrolled to the top already. The first screen
      // comes from no location, and the page starts as any other does.
      router.subscribe("onRendered", ({ fromLocation, pathChanged }) => {
        const screen = main.current;
        if (fromLocation !== undefined && pathChanged && screen !== null) {
          (screen.querySelector<HTMLElement>("h1[tabindex]") ?? screen).focus({
            preventScroll: true,
          });
        }
      }),
    [router],
  );
  return (
    <FrameContext value={frame}>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-10 focus:rounded-lg focus:bg-canvas focus:p-3"
          onClick={(event) => {
            // Focus the screen without a new entry in the history, which the router follows.
            event.preventDefault();
            main.current?.focus();
          }}
        >
          {m.skipToContent()}
        </a>
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-160 flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
            <ScreenLink to="/" className="text-lg font-semibold text-ink no-underline">
              {name}
            </ScreenLink>
            <nav aria-label={m.navigation()} className="flex flex-wrap gap-4">
              {navigation}
              <ScreenLink to="/settings">{m.settings()}</ScreenLink>
            </nav>
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-160 flex-col gap-3 px-6 pt-4 empty:hidden">
          <UpdateBanner updates={updates} />
          {banners}
        </div>
        <main id="main" ref={main} tabIndex={-1} className="page w-full grow">
          {children}
        </main>
      </div>
    </FrameContext>
  );
}
