import type { AppUpdates } from "@shkriuss/pwa";
import { type ReactNode, useRef } from "react";
import { m } from "./messages.ts";
import { UpdateBanner } from "./UpdateBanner.tsx";

export interface AppFrameProps {
  /** The app's name, at the top of every screen. */
  readonly name: string;
  /** The app's service worker, from `startServiceWorker()`, for the update banner. */
  readonly updates: AppUpdates;
  /** Links to the app's main screens. */
  readonly navigation?: ReactNode;
  /** The screen. */
  readonly children: ReactNode;
}

/**
 * The frame of every app's screens: a header with the app's name and its navigation, the
 * update banner, and the screen as the page's main content. A link that keyboard users reach
 * first skips to the screen (WCAG 2.4.1).
 */
export function AppFrame({ name, updates, navigation, children }: AppFrameProps) {
  const main = useRef<HTMLElement>(null);
  return (
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
      <div className="mx-auto w-full max-w-160 px-6 pt-4 empty:hidden">
        <UpdateBanner updates={updates} />
      </div>
      <main id="main" ref={main} tabIndex={-1} className="page w-full grow">
        {children}
      </main>
    </div>
  );
}
