import type { AppUpdates } from "@shkriuss/pwa";
import { type ReactNode, useMemo, useRef } from "react";
import { type Frame, FrameContext } from "./frame.ts";
import { m } from "./messages.ts";
import { UpdateBanner } from "./UpdateBanner.tsx";

export interface AppFrameProps {
  /** The app's name, at the top of every screen. */
  readonly name: string;
  /** The app's service worker, from `startServiceWorker()`, for the update banner. */
  readonly updates: AppUpdates;
  /** Links to the app's main screens. */
  readonly navigation?: ReactNode;
  /** Banners under the update banner, such as `<BackupReminder>`. */
  readonly banners?: ReactNode;
  /** The screen. */
  readonly children: ReactNode;
}

/**
 * The frame of every app's screens: a header with the app's name and its navigation, the
 * update banner and the others, and the screen as the page's main content. A link that keyboard
 * users reach first skips to the screen (WCAG 2.4.1).
 */
export function AppFrame({ name, updates, navigation, banners, children }: AppFrameProps) {
  const main = useRef<HTMLElement>(null);
  const frame = useMemo<Frame>(
    () => ({
      focusScreen: () => {
        // Where the user is: a banner that goes away is at the top, above the screen.
        main.current?.focus({ preventScroll: true });
      },
    }),
    [],
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
            <span className="text-lg font-semibold">{name}</span>
            {navigation === undefined ? null : (
              <nav aria-label={m.navigation()} className="flex flex-wrap gap-4">
                {navigation}
              </nav>
            )}
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
