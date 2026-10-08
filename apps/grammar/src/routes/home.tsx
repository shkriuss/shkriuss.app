import { Screen } from "@shkriuss/shell";
import { createRoute } from "@tanstack/react-router";
import { Check } from "../features/check/Check.tsx";
import { m } from "../messages.ts";
import { rootRoute } from "./root.tsx";

/** The check screen, at `/`, where the frame's name leads. */
export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});

function Home() {
  const { checker, draft } = homeRoute.useRouteContext();
  return (
    <Screen title={m.appName()}>
      <Check checker={checker} draft={draft} />
    </Screen>
  );
}
