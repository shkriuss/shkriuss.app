import { AppError, NotFound } from "@shkriuss/shell";
import { createRouter } from "@tanstack/react-router";
import { homeRoute } from "./routes/home.tsx";
import { listRoute } from "./routes/list.tsx";
import { type AppContext, rootRoute } from "./routes/root.tsx";
import { settingsRoute } from "./routes/settings.tsx";

/**
 * The app's router, with its routes declared in code (ADR 0013): each screen's route is in a
 * file of its own in `routes/`, and joins the tree here.
 */
export function createAppRouter(context: AppContext) {
  return createRouter({
    routeTree: rootRoute.addChildren([homeRoute, listRoute, settingsRoute]),
    context,
    defaultErrorComponent: AppError,
    defaultNotFoundComponent: NotFound,
  });
}

// TypeScript checks every link and navigation against these routes.
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
