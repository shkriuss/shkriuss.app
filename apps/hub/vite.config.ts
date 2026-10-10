import { fileURLToPath } from "node:url";
import { edge, FIRST_PAGE_BUDGETS } from "@shkriuss/edge";
import { BUILD_TARGET, catalog, chunkSizeWarningLimit, pageHead } from "@shkriuss/shell/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { m } from "./src/messages.ts";

export default defineConfig({
  // The browsers of architecture §14, and the bundler's chunk warning from the budget (ADR 0018).
  build: {
    target: [...BUILD_TARGET],
    chunkSizeWarningLimit: chunkSizeWarningLimit(FIRST_PAGE_BUDGETS.withoutData),
  },
  plugins: [
    tailwindcss(),
    react(),
    // The page's title and description, from the hub's messages (ADR 0012).
    pageHead({ name: m.title(), description: m.lead() }),
    // The catalog reads every app's app.config.ts in apps/ (docs/specs/hub.md §2).
    catalog(fileURLToPath(new URL("..", import.meta.url))),
    // The hub keeps no data, so its first page has the smaller budget (ADR 0018).
    edge({ firstPageBudget: FIRST_PAGE_BUDGETS.withoutData }),
  ],
});
