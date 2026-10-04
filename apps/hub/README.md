# Hub

The hub at `https://shkriuss.app`. For now it is a placeholder page; the app catalog, install guides and the privacy and security pages follow in Phase 1.4 ([roadmap](../../docs/roadmap.md)).

| Command                             | What it does                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm --filter @shkriuss/hub dev`   | Development server (without the production headers)                          |
| `pnpm --filter @shkriuss/hub build` | Production build in `dist/`, with integrity hashes and `_headers`            |
| `pnpm --filter @shkriuss/hub e2e`   | End-to-end tests against the build, served by Wrangler with the real headers |

The end-to-end tests run in Chromium, Firefox and WebKit at phone and tablet sizes. Install the browsers once with `pnpm --filter @shkriuss/hub exec playwright install chromium firefox webkit`. In Claude Code cloud sessions only the preinstalled Chromium is available, so Firefox and WebKit run in CI.
