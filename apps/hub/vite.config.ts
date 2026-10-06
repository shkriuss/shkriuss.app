import { fileURLToPath } from "node:url";
import { edge } from "@shkriuss/edge";
import { catalog } from "@shkriuss/shell/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The catalog reads every app's app.config.ts in apps/ (docs/specs/hub.md §2).
  plugins: [tailwindcss(), react(), catalog(fileURLToPath(new URL("..", import.meta.url))), edge()],
});
