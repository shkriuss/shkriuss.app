import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { type Frame as FrameValue, FrameContext } from "./frame.ts";
import { m } from "./messages.ts";
import { ScreenLink } from "./ScreenLink.tsx";

export interface FrameProps {
  /** The name at the top of every page, which leads to the first one, and in the page's title. */
  readonly name: string;
  /** Links to the main pages, as `<ScreenLink>`s. */
  readonly navigation?: ReactNode;
  /** Banners above the page, such as the update banner. */
  readonly banners?: ReactNode;
  /** What every page ends with, such as where the source code is. */
  readonly footer?: ReactNode;
  /** The page: the router's `<Outlet />`. */
  readonly children: ReactNode;
}

/**
 * The frame of every page, of the apps and of the hub: a header with the name, which leads to
 * the first page, and the navigation; the banners, in the page's status region; the page as the
 * page's main content; and a footer. A link that keyboard users reach first skips to the page
 * (WCAG 2.4.1). When the user comes to another page, its heading takes the focus. Apps take
 * `AppFrame`, which adds their settings and the update banner.
 */
export function Frame({ name, navigation, banners, footer, children }: FrameProps) {
  const main = useRef<HTMLElement>(null);
  const router = useRouter();
  const frame = useMemo<FrameValue>(
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
            {navigation === undefined ? null : (
              <nav aria-label={m.navigation()} className="flex flex-wrap gap-4">
                {navigation}
              </nav>
            )}
          </div>
        </header>
        {/* The status region of every page, an <output>, there from the start, empty as long as
            there is no banner: screen readers read a banner that appears in it. A region that
            only appears with its text, as a banner of its own would, they often leave unread. */}
        <output
          aria-atomic="false"
          className="mx-auto flex w-full max-w-160 flex-col gap-3 px-6 pt-4 empty:pt-0"
        >
          {banners}
        </output>
        <main id="main" ref={main} tabIndex={-1} className="page w-full grow">
          {children}
        </main>
        {footer === undefined ? null : (
          <footer className="border-t border-line">
            <div className="mx-auto max-w-160 px-6 py-4 text-sm text-ink-muted">{footer}</div>
          </footer>
        )}
      </div>
    </FrameContext>
  );
}
