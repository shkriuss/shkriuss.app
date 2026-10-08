import type { AppInstall, AppUpdates } from "@shkriuss/pwa";
import { AppFrame } from "@shkriuss/shell";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import type { Checker } from "../features/check/checker.ts";
import { type DraftStore, reloadWarning } from "../features/check/draft.ts";
import { m } from "../messages.ts";

/** What every screen gets from the app, which `main.tsx` starts once. */
export interface AppContext {
  readonly updates: AppUpdates;
  readonly install: AppInstall;
  /** The checker, whose worker lives as long as the page, so that its module loads once. */
  readonly checker: Checker;
  /**
   * The text on the check screen, with what goes with it, which lives as long as the page, so
   * that it stays when the user goes to the settings and back.
   */
  readonly draft: DraftStore;
}

/** The root of every screen: the shell's frame, with its update banner. */
export const rootRoute = createRootRouteWithContext<AppContext>()({ component: Root });

function Root() {
  const { updates, draft } = rootRoute.useRouteContext();
  // Updating reloads the page, which clears the text: the update banner says so.
  const warning = useSyncExternalStore(draft.subscribe, () => reloadWarning(draft.getState()));
  return (
    <AppFrame name={m.appName()} updates={updates} reloadWarning={warning}>
      <Outlet />
    </AppFrame>
  );
}
