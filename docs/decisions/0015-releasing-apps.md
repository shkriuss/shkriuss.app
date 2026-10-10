# ADR 0015: Release each app to production on its own

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

Every merge to `main` deploys every app in `apps/` to staging, and the same files go to production once the maintainer approves the `production` environment ([ADR 0006](0006-hosting-and-deployment.md), now [ADR 0017](0017-deploy-and-fix-forward.md)). The roadmap asks that each app reach production only after it has been checked on real devices: the iPhone, the Pixel and the Pixel Tablet. But the deploy to production loops over every app, so approving any change ships every app, including one that is still being built.

The hub's build must be the same file for file on staging and in production, as the deploys check ([architecture §11](../architecture.md#11-hosting-and-delivery)). It cannot leave out an app in one of them only.

## Decision

1. **Each app says whether production gets it,** in its `app.config.ts`, as `released: true,` or `released: false,` on a line of its own. TypeScript requires it, the hub's catalog refuses an app without it, and `pnpm check` holds the line to that form, which the deploy reads as it is. (Since 2026-10-10 the check also holds the line to being the value the hub reads: the word `released` once in the file, comments included, as a direct property of the one object literal, with no spread, computed key or statement after it.)
2. **A new app is not released.** Both templates say `released: false`, and `create-app` copies them. Staging gets every app, released or not.
3. **The deploy to production** checks, deploys and compares only the released apps, and the hub. The build, the file hashes and the provenance still cover every app, so staging and production get the same files of each app they have.
4. **The hub lists only released apps in production.** Its build is the same everywhere, so it decides where it runs: on `shkriuss.app`, it leaves out the apps that are not released; elsewhere, as on staging, it lists every app, and marks those that are not released.
5. **Releasing an app** is a pull request that sets `released: true`, once the maintainer has checked it on real devices. An app stays released: production keeps getting its fixes, and its users keep their data. Checklists and Grammar, which production has already, are released.

## Consequences

- Approving a deploy to production no longer ships work in progress. A new app can be merged, deployed to staging and tested there for as long as it needs.
- An app that is not released keeps whatever production had of it. As no app has been unreleased, that is nothing.
- The deploy reads one line of a TypeScript file with `grep`, which works only because `pnpm check` holds that line to one form. A change to that form must change both.

## Alternatives considered

- **A list of released apps in the workflow,** or in a file of its own: the deploy would read it easily, but an app's facts would live in two places, and a new app could be forgotten in either.
- **Building the hub separately for production:** it would break the check that production gets exactly the files that staging got.
- **A manual approval for each app:** one environment per app in GitHub, and one approval each, for every deploy. Too much ceremony for one maintainer.
