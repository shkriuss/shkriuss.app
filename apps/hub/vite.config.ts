import { edge } from "@shkriuss/edge";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), edge()],
});
