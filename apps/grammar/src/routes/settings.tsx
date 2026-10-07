import { SettingsScreenWithoutData } from "@shkriuss/shell";
import { createRoute } from "@tanstack/react-router";
import { m } from "../messages.ts";
import { rootRoute } from "./root.tsx";

/** The app's settings, at `/settings`, where the frame links to. */
export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: Settings,
});

function Settings() {
  const { install } = settingsRoute.useRouteContext();
  return (
    <SettingsScreenWithoutData
      name={m.appName()}
      description={m.appDescription()}
      install={install}
    />
  );
}
