# @shkriuss/deploy

The one package that the deploy jobs of CI install. Its only dependency is Wrangler, which deploys the built files of every app ([architecture §11](../../docs/architecture.md#11-hosting-and-delivery)). It has no code, scripts or tests of its own.

The deploy token is in the environment of `wrangler deploy` only, but every package installed beside it is one whose code could run there. `pnpm install --frozen-lockfile --filter @shkriuss/deploy` installs Wrangler and its own dependencies, and the root's few tools, which pnpm installs with any filter: some 45 packages instead of the several hundred of the whole workspace. That narrows what runs beside the token until staging has a Cloudflare account of its own, whose token cannot write production's Workers ([threat model](../../docs/threat-model.md), T3).

Each app's `wrangler.json` stays with the app. The deploy jobs point Wrangler at it, and Wrangler reads the app's `dist/` relative to that file:

```sh
pnpm --filter @shkriuss/deploy exec wrangler deploy -c "$PWD/apps/hub/wrangler.json" --env staging
```
