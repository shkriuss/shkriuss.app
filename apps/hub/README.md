# Hub

The hub at `https://shkriuss.app`, and `https://shkriuss.dev` for staging: the apps, how to install them, and what happens to the user's data ([hub spec](../../docs/specs/hub.md)). It is a site, not an app: it holds no data and has no service worker.

| Path                   | What it is                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/`          | The pages, with routes declared in code ([ADR 0013](../../docs/decisions/0013-routes-in-code.md)): `/`, `/install`, `/privacy`, `/security`                          |
| `src/AppCard.tsx`      | An app in the catalog, with its privacy label and its link                                                                                                           |
| `src/Verification.tsx` | A section of the security page that loads on demand, so the end-to-end tests cover a lazily loaded chunk ([ADR 0010](../../docs/decisions/0010-script-integrity.md)) |
| `src/messages.ts`      | All of the hub's text, the privacy policy's too                                                                                                                      |
| `vite.config.ts`       | The build: `catalog()` of `@shkriuss/shell/vite`, which reads every app's `app.config.ts`, and `edge()`, last                                                        |

- **The catalog** lists every app in `apps/`, as their `app.config.ts` and messages are when the hub is built: builds are never cached.
- **Links to apps** go to `https://<id>.` and the hub's own host, so the same build links to staging's apps on staging, and to production's in production.
- **The privacy policy** says when it last changed: change that date with its text, in `src/messages.ts`.

| Command                             | What it does                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm --filter @shkriuss/hub dev`   | Development server (without the production headers)                          |
| `pnpm --filter @shkriuss/hub build` | Production build in `dist/`, with integrity hashes and `_headers`            |
| `pnpm --filter @shkriuss/hub e2e`   | End-to-end tests against the build, served by Wrangler with the real headers |

The end-to-end tests run in Chromium, Firefox and WebKit at phone and tablet sizes. Install the browsers once with `pnpm --filter @shkriuss/hub exec playwright install chromium firefox webkit`. In Claude Code cloud sessions only the preinstalled Chromium is available, so Firefox and WebKit run in CI.
