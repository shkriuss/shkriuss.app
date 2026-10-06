# Checklists

Lists to tick off, for shopping, packing or to-dos, that stay on this device.

- **Address:** `https://checklists.shkriuss.app`, and `https://checklists.shkriuss.dev` for staging.
- **Id:** `checklists`, which never changes: it is the app's subdomain and folder, and the app that its backups belong to.
- **Made** with `create-app` from the [app template](../../tooling/app-template/README.md), which says what each file is.
- **Spec:** [docs/specs/apps/checklists.md](../../docs/specs/apps/checklists.md): its screens, its data and how backups merge it. It is the pilot app of Phase 1.

| Path                  | What it is                                                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/lists/` | The two screens, of all lists and of one, their forms, and what they show of the data (`lists.ts`, with its unit tests)                                                                                                 |
| `src/routes/`         | The routes: `/`, `/lists/<id>` and `/settings`                                                                                                                                                                          |
| `src/schema.ts`       | The data's schema versions                                                                                                                                                                                              |
| `e2e/app.spec.ts`     | The end-to-end tests of the spec's §5, with two devices for merging                                                                                                                                                     |
| `e2e/fixtures/`       | A backup of each schema version, plain and encrypted, which the app must always restore ([backup format §8](../../docs/specs/backup-format.md#8-compatibility)). Never change them; add one for each new schema version |

| Command                                    | What it does                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `pnpm --filter @shkriuss/checklists dev`   | Development server, without the production headers and the service worker    |
| `pnpm --filter @shkriuss/checklists build` | Production build in `dist/`                                                  |
| `pnpm --filter @shkriuss/checklists test`  | Unit tests                                                                   |
| `pnpm --filter @shkriuss/checklists e2e`   | End-to-end tests against the build, served by Wrangler with the real headers |
