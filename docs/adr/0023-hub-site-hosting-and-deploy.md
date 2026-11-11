# 0023 Hub site hosting and deploy

- Status: Accepted
- Date: 2026-11-11
- Source: the owner's prompt for Phase 0, step 7
  ([PROMPTS.md](../development/PROMPTS.md)), the owner's review of and
  decisions on
  [pull request 10](https://github.com/shkriuss/shkriuss.app/pull/10), and
  [plan](../plan/PLAN.md) sections 7, 10, 13, 15 and 17

## Context

- The owner asked: the site workflow builds on pull requests without
  deploying. On `main` it deploys to Cloudflare with the `cloudflare`
  environment and its secret `CLOUDFLARE_API_TOKEN`. The deploy tool is
  pinned to an exact version.
- Secrets live only in environments limited to `main`. Claude has no
  Cloudflare access (section 15).
- The threat model defends against takeover of GitHub, Cloudflare or the
  domain, and against malicious dependencies or CI actions (section 10).
  The site shows the signing fingerprint, so a changed site could mislead
  users.
- The sync server will be a Cloudflare Worker (section 7).
- Since 2026-09-15, a Cloudflare account API token can be limited to
  chosen Workers, with one of four roles. Editor may update and deploy an
  existing Worker, but cannot create or delete one. Per-Worker access works
  only for a Worker that already exists. Wrangler uses these limits only
  with an account API token, not with a user token. Changing routes or
  custom domains also needs a zone permission. Custom domains do not
  support per-Worker roles yet. (Cloudflare's docs, "Workers roles and
  permissions", and its changelog entry of 2026-09-15.)
- Wrangler, Cloudflare's deploy tool, compares a Worker that was last
  changed in the dashboard with the local configuration before it deploys.
  Up to version 4.156.1, that comparison always read the Worker's routes
  and custom domains, which a per-Worker Editor token may not read. Version
  4.156.2, released on 2026-11-02, reads them only when the local
  configuration has some (Wrangler's changelog, pull request 16531 of
  `cloudflare/workers-sdk`). A Worker made by hand in the dashboard is such
  a Worker until its first deploy.
- A first draft of this record, in pull request 10, chose Cloudflare
  Pages, because a Pages token could not reach the Workers. The owner
  replaced it with this one before it was merged.

## Decision

1. The site is a Cloudflare Worker with static assets only and no Worker
   script. No code of ours runs on Cloudflare. The Worker is called
   `shkriuss-hub`.
2. The owner creates the Worker by hand in the dashboard, once. The
   workflow never creates it. Before every deploy it checks that the Worker
   exists, and stops with a clear message if it does not.
3. The token is an account API token with one permission: Editor on the
   Worker `shkriuss-hub` only. No zone permission. So it can deploy that one
   Worker, and cannot create, delete or reach any other Worker, route or
   domain. The account ID is the variable `CLOUDFLARE_ACCOUNT_ID` of the
   `cloudflare` environment. It is not a secret.
   The owner's domain is the optional variable `SITE_DOMAIN` of the same
   environment, also not a secret.
4. The owner attaches `shkriuss.app` to the Worker by hand in the
   dashboard. The Worker's configuration has no routes and no custom
   domains, so Wrangler never changes them.
5. The Worker also answers at
   `shkriuss-hub.<account subdomain>.workers.dev`, where every deploy is
   checked. Preview addresses for each version are off.
6. The configuration is
   [`.github/site-deploy/wrangler.jsonc`](../../.github/site-deploy/wrangler.jsonc):
   - `html_handling: auto-trailing-slash`: `/apps/` serves
     `apps/index.html`.
   - `not_found_handling: 404-page`: an unknown address gets `404.html`
     with the status 404.
7. The deploy tool is Wrangler 4.156.2, the first version that deploys
   with a per-Worker Editor token to a Worker last changed in the
   dashboard. It was 9 days old. The owner accepted it as an exception to
   the habit of pinning versions that are more than a month old.
   - [`.github/site-deploy/package.json`](../../.github/site-deploy/package.json)
     pins it to that exact version.
   - `package-lock.json` next to it pins every package with its SHA-512
     checksum, all from `https://registry.npmjs.org/`.
   - [`install.sh`](../../.github/site-deploy/install.sh) checks both, then
     installs with `npm ci --ignore-scripts --engine-strict`. No package
     runs code while it is installed.
   - All four files live in `.github/`, so they are owner-only.
8. Wrangler runs on the Node.js of GitHub's runner. Image 20261101 has
   22.23.4. Wrangler 4.156.2 needs 22.0.0 or newer.
9. The workflow [`site.yml`](../../.github/workflows/site.yml) has three
   jobs:

   | Job | Runs on | Secrets | Project code |
   |---|---|---|---|
   | Build | Pull requests that change the site, every push to `main` | None | Runs the generator and its tests |
   | Deploy tool | Pull requests only | None | None. Installs the pinned Wrangler and tries the deploy with the built site, without uploading |
   | Deploy | `main` only, environment `cloudflare` | `CLOUDFLARE_API_TOKEN`, in one step | None |

10. Build checks what the generator wrote, without trusting it: only
    `.html`, `.css` and `.svg` files; no script, frame, form, plugin, event
    handler or inline style; nothing loaded from another site; links only
    to `https://`, the site itself or a heading. Then it adds the security
    headers and records a SHA-256 for every file.
11. The security headers are written in `site.yml`, which is owner-only.
    Build puts them in the file `_headers`, which Cloudflare reads for the
    Worker's static assets.
12. Deploy:
    1. stops unless its commit is still the newest on `main`, so an older
       run never replaces a newer site,
    2. checks the files against Build's SHA-256 values,
    3. installs the pinned Wrangler,
    4. checks that the Worker exists, and notes its tag,
    5. runs `wrangler deploy` with `wrangler.jsonc` only,
    6. stops unless Wrangler reports the same Worker tag, a new version
       and the Worker's `workers.dev` address,
    7. asks the live site for every file until it serves exactly the
       uploaded bytes, then fails unless each answer has each security
       header once, with exactly its value. It names itself in the
       User-Agent, because `workers.dev` turns away default library
       User-Agents.
    8. does the same on `https://<SITE_DOMAIN>`, if the variable is set.
       It checks the value first: a plain domain name, with no scheme, path
       or port. If the variable is not set, it skips the domain, and the
       summary says so.
13. Wrangler sends no usage data (`WRANGLER_SEND_METRICS=false`).

## Options rejected

- **Cloudflare Pages.** The first draft of this record chose it, because
  its token could not reach the sync server's Worker. Since 2026-09-15 a
  Workers token can be limited to one Worker, so that reason no longer
  holds. The plan chose Workers at the start, and the sync server will be
  a Worker too. Cloudflare also recommends Workers for new projects.
- **A token for all Workers.** It could edit every Worker in the account,
  including the sync server later. It stays only as a fallback, if the
  account does not offer the per-Worker scope
  ([site.md](../development/site.md#if-your-account-does-not-offer-specified-workers)).
- **Letting the workflow create the Worker.** That needs Admin for all
  Workers, which can also delete any Worker.
- **Routes or a custom domain in `wrangler.jsonc`.** The token would need
  a zone permission, and a mistake there could move the domain.
- **Wrangler 4.149.0 or older.** The first deploy to the Worker made by
  hand would fail with a per-Worker Editor token, as above.
- **Cloudflare building the site from the repository (Git integration).**
  Cloudflare's GitHub app would get access to the repository. Cloudflare
  would build pull requests itself, outside the pinned workflow and its
  checks.
- **`cloudflare/wrangler-action`.** Not one of GitHub's own actions. A
  shell step does the same.
- **`npx wrangler@4.156.2`.** It pins Wrangler but not the packages
  Wrangler needs, which could change between runs.
- **GitHub Pages.** The owner asked for Cloudflare. GitHub Pages also
  cannot send the security headers.

## Consequences

- Before the first deploy, the owner creates the Worker and the token, and
  stores the token and the account ID, from a phone
  ([site.md](../development/site.md#set-up-cloudflare)).
- The first deploy replaces the Worker's "Hello World" code with the
  static site.
- Every push to `main` deploys, also when the site did not change.
  Wrangler uploads only files that Cloudflare does not have yet.
- Wrangler and the packages it needs run with the token. They are pinned
  and checked, and none of them runs while it is installed. A harmful
  version that was pinned anyway could misuse the token. The token reaches
  only the Worker `shkriuss-hub`. Users are told to compare the fingerprint
  with the one on GitHub.
- Wrangler 4.156.2 was 9 days old when it was chosen. No older version
  works with a per-Worker Editor token, as above. The owner accepted the
  exception on pull request 10. Later updates go back to versions that are
  more than a month old.
- A Wrangler update is a new lockfile in a pull request. It is owner-only
  and flagged by the protected-paths workflow. Prompt R5
  ([PROMPTS.md](../development/PROMPTS.md)), the monthly updates, covers
  it.
- Hard rule 5 in [CLAUDE.md](../../CLAUDE.md) covers tools outside Gradle:
  they are pinned with a lockfile and checksums in an owner-only folder,
  and need a record. This is that record for Wrangler.
- The account ID appears in the public run logs. It does nothing without a
  token.
- The owner sets `SITE_DOMAIN` after attaching the domain. Until then,
  only the `workers.dev` address is checked. A zone setting that adds a
  header, such as HSTS, makes the check fail on the domain alone.
- Not tried before the first deploy: the real token and its per-Worker
  scope, the real upload, and whether Cloudflare sends `_headers` exactly
  as written (section 17, "That the Cloudflare token works with the deploy
  tool"). Deploy checks all three every time.
- The `backend` workflow (section 13) gets its own token for its own
  Worker in Phase 5.
- The generator is in [0022](0022-hub-site-generator.md).
