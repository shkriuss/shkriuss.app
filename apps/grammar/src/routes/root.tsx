import type { AppInstall, AppUpdates } from "@shkriuss/pwa";
import { AppFrame } from "@shkriuss/shell";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { Checker } from "../features/check/checker.ts";
import { m } from "../messages.ts";

/** What every screen gets from the app, which `main.tsx` starts once. */
export interface AppContext {
  readonly updates: AppUpdates;
  readonly install: AppInstall;
  /** The checker, whose worker lives as long as the page, so that its module loads once. */
  readonly checker: Checker;
}

/** The root of every screen: the shell's frame, with its update banner. */
export const rootRoute = createRootRouteWithContext<AppContext>()({ component: Root });

function Root() {
  const { updates } = rootRoute.useRouteContext();
  return (
    <AppFrame name={m.appName()} updates={updates}>
      <Outlet />
    </AppFrame>
  );
}
