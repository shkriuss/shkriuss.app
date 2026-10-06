import type { AppInstall, AppStorage } from "@shkriuss/pwa";
import {
  AppFrame,
  type AppUpdatesWithDatabase,
  BackupReminder,
  InstallBanner,
} from "@shkriuss/shell";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { config } from "../../app.config.ts";
import { m } from "../messages.ts";
import type { AppDatabase } from "../schema.ts";

/** What every screen gets from the app, which `main.tsx` opens and starts once. */
export interface AppContext {
  readonly db: AppDatabase;
  readonly updates: AppUpdatesWithDatabase;
  readonly install: AppInstall;
  readonly storage: AppStorage;
}

/** The root of every screen: the shell's frame, with its banners. */
export const rootRoute = createRootRouteWithContext<AppContext>()({ component: Root });

function Root() {
  const { db, updates, install } = rootRoute.useRouteContext();
  return (
    <AppFrame
      name={m.appName()}
      updates={updates}
      banners={
        <>
          <InstallBanner install={install} db={db} />
          <BackupReminder app={config.id} db={db} />
        </>
      }
    >
      <Outlet />
    </AppFrame>
  );
}
