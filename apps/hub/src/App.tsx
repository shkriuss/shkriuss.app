import { lazy, Suspense } from "react";
import { LoadBoundary } from "./LoadBoundary.tsx";
import { m } from "./messages.ts";

// Loaded on demand on purpose. Until the hub has real routes, this keeps one lazily loaded
// chunk in the build, so the end-to-end tests cover import-map integrity (ADR 0010).
const Principles = lazy(() => import("./Principles.tsx"));

export function App() {
  return (
    <main className="page">
      <h1 className="mb-2 text-[clamp(2rem,8vw,3rem)] leading-tight font-bold tracking-tight">
        {m.title()}
      </h1>
      <p className="mb-4 text-xl">{m.lead()}</p>
      <p className="text-ink-muted">{m.comingSoon()}</p>
      <LoadBoundary>
        <Suspense fallback={null}>
          <Principles />
        </Suspense>
      </LoadBoundary>
    </main>
  );
}
