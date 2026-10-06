import { SettingsScreen } from "@shkriuss/shell";
import { createRoute } from "@tanstack/react-router";
import { config } from "../../app.config.ts";
import { m } from "../messages.ts";
import { schemas } from "../schema.ts";
import { rootRoute } from "./root.tsx";

/** The app's settings, at `/settings`, where the frame links to. */
export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: Settings,
});

function Settings() {
  const { db, install, storage } = settingsRoute.useRouteContext();
  return (
    <SettingsScreen
      app={config.id}
      name={m.appName()}
      description={m.appDescription()}
      db={db}
      schemas={schemas}
      install={install}
      storage={storage}
    />
  );
}
