import { REPORT_URL, Screen, SECURITY_URL, SOURCE_URL } from "@shkriuss/shell/site";
import { createRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { LoadBoundary } from "../LoadBoundary.tsx";
import { m } from "../messages.ts";
import { rootRoute } from "./root.tsx";

/** How the apps are protected, and how to report a problem, at `/security` (docs/specs/hub.md §1). */
export const securityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/security",
  component: Security,
});

// Loaded on demand on purpose: it keeps a lazily loaded chunk in the build, so that the
// end-to-end tests cover import-map integrity (ADR 0010). If the browser refuses it, the page
// goes without it.
const Verification = lazy(async () => import("../Verification.tsx"));

const THREAT_MODEL = `${SOURCE_URL}/blob/main/docs/threat-model.md`;

function Security() {
  return (
    <Screen title={m.security()}>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{m.protection()}</h2>
        <ul className="list-disc ps-6">
          <li>{m.integrity()}</li>
          <li>{m.policy()}</li>
          <li>{m.origins()}</li>
          <li>{m.offlineCopy()}</li>
        </ul>
        <p>
          <a href={THREAT_MODEL}>{m.threatModel()}</a> {m.threatModelText()}
        </p>
      </section>
      <LoadBoundary>
        <Suspense fallback={null}>
          <Verification />
        </Suspense>
      </LoadBoundary>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{m.report()}</h2>
        <p>{m.reportText()}</p>
        <p className="flex flex-wrap gap-x-4">
          <a href={REPORT_URL}>{m.reportLink()}</a>
          <a href={SECURITY_URL}>{m.policyLink()}</a>
        </p>
      </section>
    </Screen>
  );
}
