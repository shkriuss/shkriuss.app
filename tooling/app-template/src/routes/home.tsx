import { Screen } from "@shkriuss/shell";
import { createRoute } from "@tanstack/react-router";
import { Items } from "../features/items/Items.tsx";
import { m } from "../messages.ts";
import { rootRoute } from "./root.tsx";

/** The app's first screen, at `/`, where the frame's name leads. */
export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});

function Home() {
  const { db } = homeRoute.useRouteContext();
  return (
    <Screen title={m.appName()}>
      <Items db={db} />
    </Screen>
  );
}
