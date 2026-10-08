import { Licenses, Screen } from "@shkriuss/shell/site";
import { createRoute } from "@tanstack/react-router";
import { m } from "../messages.ts";
import { rootRoute } from "./root.tsx";

/**
 * The licenses of the software of others that the hub includes, from its `/licenses.txt`, at
 * `/licenses` (docs/specs/hub.md §1): on a page, where the text wraps, as in the apps' About.
 */
export const licensesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/licenses",
  component: LicensesPage,
});

function LicensesPage() {
  return (
    <Screen title={m.licenses()}>
      <Licenses />
    </Screen>
  );
}
