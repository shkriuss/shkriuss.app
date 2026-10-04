import { lazy, Suspense } from "react";
import { LoadBoundary } from "./LoadBoundary.tsx";

// Loaded on demand on purpose. Until the hub has real routes, this keeps one lazily loaded
// chunk in the build, so the end-to-end tests cover import-map integrity (ADR 0010).
const Principles = lazy(() => import("./Principles.tsx"));

export function App() {
  return (
    <main>
      <h1>shkriuss.app</h1>
      <p className="lead">Small, private web apps that work offline.</p>
      <p>The first apps are on their way.</p>
      <LoadBoundary>
        <Suspense fallback={null}>
          <Principles />
        </Suspense>
      </LoadBoundary>
    </main>
  );
}
