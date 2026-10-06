import "@shkriuss/ui/styles.css";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHubRouter } from "./router.ts";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("index.html has no #root element.");
}
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={createHubRouter()} />
  </StrictMode>,
);
