import { Screen, listedApps } from "@shkriuss/shell/site";
import { createRoute } from "@tanstack/react-router";
import { useId } from "react";
import { apps } from "virtual:shkriuss/catalog";
import { AppCard } from "../AppCard.tsx";
import { m } from "../messages.ts";
import { rootRoute } from "./root.tsx";

/** The first page, at `/`: what the apps are, then every app (docs/specs/hub.md §1, §2). */
export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});

function Home() {
  const heading = useId();
  const shown = listedApps(apps, location.hostname);
  return (
    <Screen title={m.title()}>
      <p className="text-xl">{m.lead()}</p>
      <p>{m.intro()}</p>
      <h2 id={heading} className="text-xl font-semibold">
        {m.apps()}
      </h2>
      {shown.length === 0 ? (
        <p>{m.noApps()}</p>
      ) : (
        <ul aria-labelledby={heading} className="flex flex-col gap-4">
          {shown.map((app) => (
            <AppCard key={app.id} app={app} />
          ))}
        </ul>
      )}
    </Screen>
  );
}
