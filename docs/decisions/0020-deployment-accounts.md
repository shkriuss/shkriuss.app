# ADR 0020: One Cloudflare account per environment

- **Status:** Proposed
- **Date:** 2026-10-10

## Context

Both domains, and with them both environments, live in one Cloudflare account ([ADR 0001](0001-domains-and-environments.md), [ADR 0006](0006-hosting-and-deployment.md)). CI deploys with two API tokens, one per environment ([ADR 0007](0007-security-baseline.md), point 8), each with "Account → Workers Scripts → Edit" and "Zone → Workers Routes → Edit" on its own zone. The deploy to staging runs on every merge to `main` without approval; the deploy to production waits for the maintainer's approval of the `production` environment ([ADR 0017](0017-deploy-and-fix-forward.md)).

The audit of 2026-10-10 (CI-01) found that the approval protects only the honest path. Cloudflare's "Workers Scripts: Edit" is account-wide: it cannot be limited to named scripts, and replacing a script's content needs no zone permission. So the staging token can replace the content of `shkriuss-hub-production` and the other production Workers, which already serve the production domains, through the API or with `wrangler deploy --env production`, and nothing downstream (`reproduce`, `attest`, `check-live`) would notice. Anything that runs in the `deploy-staging` job with the token in its environment could do that: the dependency closure of Wrangler, pnpm itself, or a workflow or `wrangler.json` change merged to `main`, which the ruleset lets the one maintainer merge with no second review. The threat model's T3 and T4 and ADR 0007's "narrowly scoped API tokens, one per environment" claimed a separation that one account cannot give.

## Decision

1. **Staging gets a Cloudflare account of its own.** The `shkriuss.dev` zone moves there, with its Access application and its deploy token; the production account keeps `shkriuss.app`, its token and the production Workers. The `staging` environment in GitHub names the new account in `CLOUDFLARE_ACCOUNT_ID`, which the workflow already reads per environment; `wrangler.json` names no account and needs no change.
2. **The separation is verified,** not assumed: with the staging token, `GET https://api.cloudflare.com/client/v4/accounts/<production account id>/workers/scripts` answers 403; the next merge to `main` deploys staging into the new account, and `https://shkriuss.dev` opens behind Access there.
3. **Until the accounts are split,** the deploy jobs run with the smallest dependency closure that deploys: `@shkriuss/deploy` ([`tooling/deploy`](../../tooling/deploy/README.md)), a workspace package whose only dependency is `wrangler`, installed with `pnpm install --frozen-lockfile --filter @shkriuss/deploy` in both deploy jobs, so that Wrangler's own dependencies and the root's few tools are installed beside a token instead of the whole workspace's. They also deploy only the commit that `main` still points at ([architecture §11](../architecture.md#11-hosting-and-delivery)). The [threat model](../threat-model.md#5-residual-risks-accepted) records the gap, G1, until points 1 and 2 are done.
4. **The owner's steps,** in order:
   1. Create a second Cloudflare account for staging and protect it as the [setup checklist §1](../setup-checklist.md#1-protect-the-accounts-do-this-first) says.
   2. Move the `shkriuss.dev` zone there: a domain on Cloudflare Registrar can be moved to another account in the dashboard; otherwise add the zone in the new account and point the registrar's nameservers at the ones it gives. Re-enable DNSSEC in the new account and update the DS record at the registrar (Cloudflare Registrar does that by itself), then set [§2](../setup-checklist.md#2-both-domains-in-cloudflare-shkriussapp-and-shkriussdev) again for the zone: SSL/TLS, CAA, the email records, the features that stay off, Network Error Logging.
   3. In the new account's Zero Trust, add the One-time PIN provider and the Access application for `shkriuss.dev` and `*.shkriuss.dev` with its Allow policy ([§3](../setup-checklist.md#3-github-repository-shkriussshkriussapp)).
   4. Create the staging token in the new account, with the permissions of §3, and copy the new account's id.
   5. In GitHub's `staging` environment, replace `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
   6. Verify as point 2 says.
   7. In the production account, delete the old staging token and the Workers `shkriuss-hub-staging`, `shkriuss-checklists-staging` and `shkriuss-grammar-staging`, which the new account now serves.

## Consequences

- A token in the unapproved job can at worst replace staging. Replacing production needs the production token, which only the approved job holds.
- Two accounts to secure (two-factor authentication on each) and two sets of zone settings to keep alike: DNSSEC, CAA, the email records, the features that stay off and Network Error Logging.
- Moving the zone changes its DNSSEC keys, so DNSSEC is set up again in the new account; until the DS record at the registrar matches, validating resolvers refuse the zone. The staging origins are private, so the moment matters little.
- `wrangler.json`, the workflow and the build stay as they are: the account comes from the environment, and staging and production still get the same files.
- "Both domains in one account" in ADR 0001 and ADR 0006 no longer holds; their decisions on domains and hosting stand.

## Alternatives considered

- **A narrower token:** Cloudflare has no permission for one Worker, or for one environment's Workers; "Workers Scripts: Edit" covers the account. Impossible.
- **Separate zones in one account:** that is what exists. Zone permissions govern routes and custom domains, not a script's content, which is what an attacker would replace. Does not help.
- **Trusting the production approval:** it protects the path that CI takes, which is the only honest one; the gap the audit found is every other path from a job that holds the staging token.
- **Deploying staging from the approved job too, or by hand:** staging exists so that every merge can be tested on real devices before anyone approves; a staging deploy that waits for an approval is production with another name, and a deploy by hand puts the token on a machine instead.
