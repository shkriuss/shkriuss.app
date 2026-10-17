# calendar

Lives at <https://calendar.shkriuss.app>. Its name, description, icon and
colour are in [`packages/registry/apps.json`](../../packages/registry/apps.json).

- Page: `src/pages/index.astro`
- Tests: `e2e/` (the shared accessibility, security and offline checks run
  automatically too)
- Build settings: `astro.config.ts` (shared, from `@shkriuss/astro-config`)
- Cloudflare settings: `wrangler.jsonc`

See [docs/adding-an-app.md](../../docs/adding-an-app.md) for the full guide.
