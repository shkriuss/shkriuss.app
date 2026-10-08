import { fileURLToPath } from "node:url";
import { edge } from "@shkriuss/edge";
import { catalog, pageHead } from "@shkriuss/shell/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { m } from "./src/messages.ts";

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    // The page's title and description, from the hub's messages (ADR 0012).
    pageHead({ name: m.title(), description: m.lead() }),
    // The catalog reads every app's app.config.ts in apps/ (docs/specs/hub.md §2).
    catalog(fileURLToPath(new URL("..", import.meta.url))),
    edge(),
  ],
});
