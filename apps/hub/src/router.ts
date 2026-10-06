import { createRouter } from "@tanstack/react-router";
import { ErrorPage, NotFoundPage } from "./pages.tsx";
import { homeRoute } from "./routes/home.tsx";
import { installRoute } from "./routes/install.tsx";
import { privacyRoute } from "./routes/privacy.tsx";
import { rootRoute } from "./routes/root.tsx";
import { securityRoute } from "./routes/security.tsx";

/** The hub's router, with its routes declared in code (ADR 0013). */
export function createHubRouter() {
  return createRouter({
    routeTree: rootRoute.addChildren([homeRoute, installRoute, privacyRoute, securityRoute]),
    defaultErrorComponent: ErrorPage,
    defaultNotFoundComponent: NotFoundPage,
  });
}

// TypeScript checks every link and navigation against these routes.
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createHubRouter>;
  }
}
