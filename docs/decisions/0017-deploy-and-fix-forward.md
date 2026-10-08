# ADR 0017: Deploy every app, and fix forward

- **Status:** Proposed
- **Date:** 2026-10-08

## Context

[ADR 0006](0006-hosting-and-deployment.md) chose Cloudflare Workers with static assets, deployed by GitHub Actions with Wrangler. That stands. Two of its points do not match what CI does, or what the data allows:

- **"Each merge to `main` deploys the changed apps to staging."** CI deploys every app on every merge. Which apps a commit changes is easy to get wrong: a change to a platform package changes every app that uses it.
- **"Rolling back means redeploying the previous version," and "each app deploys and rolls back independently."** One workflow deploys every app. And an older version of an app never opens a database that a newer one has upgraded ([architecture §7](../architecture.md#7-data-layer)). After a release that raises an app's schema version, redeploying the previous version would leave every user who opened the new one without their data, until a newer release.

## Decision

1. **Hosting stays as in ADR 0006:**
   - Workers with static assets, one per app and one for the hub, each with a custom domain per environment, and no Worker script;
   - the Free plan;
   - deploys by GitHub Actions and Wrangler, never by Workers Builds;
   - staging behind Cloudflare Access, with `noindex`;
   - Cloudflare's features that rewrite pages kept off.
2. **Every merge to `main` deploys every app, and the hub, to staging,** from one build that CI has checked. Production gets the same files after manual approval, for the apps that are released ([ADR 0015](0015-releasing-apps.md)).
3. **A bad release is fixed forward.** A new commit, usually a revert, goes through CI and both deploys like any other.
4. **Never redeploy an older build of an app** whose schema version is lower than the live one's.
5. **A broken service worker** is replaced by the kill switch of `@shkriuss/pwa`, which never brings back an older schema version.
6. **Cloudflare's rollback of a Worker's version** is for emergencies only, and only for an app whose schema version the bad release did not change.

## Consequences

- Every deploy takes one path, which CI tests. There is no manual rollback to get wrong.
- A fix takes a CI run, rather than a click in Cloudflare's dashboard.
- An app that did not change is deployed again with the same files. Cloudflare uploads only the files it does not have.
- ADR 0006's text stays as it was; this ADR replaces it. The architecture (§11) says how to roll back.

## Alternatives considered

- **Deploy only the apps that a commit changed:** it needs change detection across the shared packages, and one missed dependency ships an app built from older code than the rest.
- **Roll back by redeploying the previous version:** it works only while no release raises a schema version. A rule that holds most of the time is the rule that someone follows on the one day it breaks.
