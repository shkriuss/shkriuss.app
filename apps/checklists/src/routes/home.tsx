import { Screen } from "@shkriuss/shell";
import { createRoute } from "@tanstack/react-router";
import { AllLists } from "../features/lists/AllLists.tsx";
import { m } from "../messages.ts";
import { rootRoute } from "./root.tsx";

/** The app's first screen, at `/`, where the frame's name leads: every list. */
export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});

function Home() {
  const { db } = homeRoute.useRouteContext();
  return (
    <Screen title={m.appName()}>
      <AllLists db={db} />
    </Screen>
  );
}
