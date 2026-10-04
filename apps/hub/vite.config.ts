import { edge } from "@shkriuss/edge";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), edge()],
  build: {
    // Every supported browser has module preloading; the polyfill would only add code.
    modulePreload: { polyfill: false },
    rolldownOptions: {
      output: {
        // React in a chunk of its own, which browsers keep cached across releases of the hub.
        // It also gives the end-to-end tests a preloaded, statically imported chunk to check.
        codeSplitting: {
          groups: [
            { name: "react", test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
  },
});
