import { Screen } from "@shkriuss/shell";
import { createRoute } from "@tanstack/react-router";
import { Words } from "../features/words/Words.tsx";
import { m } from "../messages.ts";
import { rootRoute } from "./root.tsx";

/** The app's first screen, at `/`, where the frame's name leads. */
export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Home,
});

function Home() {
  return (
    <Screen title={m.appName()}>
      <Words />
    </Screen>
  );
}
