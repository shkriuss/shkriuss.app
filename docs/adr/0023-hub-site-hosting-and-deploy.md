# 0023 Hub site hosting and deploy

- Status: Accepted
- Date: 2026-11-11
- Source: the owner's prompt for Phase 0, step 7
  ([PROMPTS.md](../development/PROMPTS.md)), and
  [plan](../plan/PLAN.md) sections 10, 13, 15 and 17

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
- Cloudflare offers two ways to serve static files: Pages, and Workers with
  static assets. Wrangler is Cloudflare's tool for both. Wrangler 4.149.0
  says Workers are recommended for new projects. Pages is still supported.
- The sync backend will be a Worker in the owner's Cloudflare account
  (section 7).
- Wrangler is an npm package. Version 4.149.0 installs 40 packages on
  Linux. Its lockfile lists 92, because some are only for other systems.
- Only GitHub's own actions are allowed in the repository today
  ([ci.md](../development/ci.md#actions-used)).

## Decision

1. The site is served by Cloudflare Pages, by direct upload. The project
   is called `shkriuss-app`. Its production branch is `main`. Its address
   is `https://shkriuss-app.pages.dev`, unless Cloudflare has to add
   characters because the name is taken.
2. The deploy tool is Wrangler 4.149.0, released on 2026-10-08, more than
   a month before it was chosen.
   - [`.github/site-deploy/package.json`](../../.github/site-deploy/package.json)
     pins it to that exact version.
   - `package-lock.json` next to it pins every package with its SHA-512
     checksum, all from `https://registry.npmjs.org/`.
   - [`install.sh`](../../.github/site-deploy/install.sh) checks both, then
     installs with `npm ci --ignore-scripts --engine-strict`. No package
     runs code while it is installed.
   - All three live in `.github/`, so they are owner-only.
3. Wrangler runs on the Node.js of GitHub's runner. Image 20261101 has
   22.23.4. Wrangler 4.149.0 needs 22.0.0 or newer.
4. The workflow [`site.yml`](../../.github/workflows/site.yml) has three
   jobs:

   | Job | Runs on | Secrets | Project code |
   |---|---|---|---|
   | Build | Pull requests that change the site, every push to `main` | None | Runs the generator and its tests |
   | Deploy tool | Pull requests only | None | None. Installs the pinned Wrangler |
   | Deploy | `main` only, environment `cloudflare` | `CLOUDFLARE_API_TOKEN`, in one step | None |

5. Build checks what the generator wrote, without trusting it: only
   `.html`, `.css` and `.svg` files; no script, frame, form, plugin, event
   handler or inline style; nothing loaded from another site; links only to
   `https://`, the site itself or a heading. Then it adds the security
   headers and records a SHA-256 for every file.
6. The security headers are written in `site.yml`, which is owner-only. Build
   puts them in the file `_headers`, which Cloudflare Pages reads. After
   every deploy, Deploy asks the live site for every file and fails unless
   each answer has each header once, with exactly its value.
7. Deploy checks the files against Build's SHA-256 values, installs the
   pinned Wrangler and uploads. It runs Wrangler outside the checkout, in a
   folder with no Wrangler settings and no `functions/` folder, so no code
   runs on Cloudflare.
8. Only the newest commit on `main` deploys. Every push to `main` starts the
   workflow. Deploy first checks that its commit is still the newest one,
   and deploys wait for each other. So an older run never replaces a newer
   site.
9. The first deploy makes the Pages project through Cloudflare's API, if it
   does not exist yet.
10. The token is a Cloudflare API token with one permission: Account,
    Cloudflare Pages, Edit, for the owner's one account. The account ID is
    the variable `CLOUDFLARE_ACCOUNT_ID` of the `cloudflare` environment.
    It is not a secret.
11. Wrangler sends no usage data (`WRANGLER_SEND_METRICS=false`).

## Options rejected

- **Workers with static assets.** Cloudflare recommends it for new
  projects. But its token needs the permission to edit Workers, which
  covers every Worker in the account, including the sync backend later.
  It also needs the account's `workers.dev` subdomain to be registered
  first. Moving later is small: the `_headers` file works the same there.
- **Cloudflare building the site from the repository (Git integration).**
  Cloudflare's GitHub app would get access to the repository. Cloudflare
  would build pull requests itself, outside the pinned workflow and its
  checks, and publish previews of pull requests nobody reviewed.
- **`cloudflare/wrangler-action`.** Not one of GitHub's own actions. A
  shell step does the same.
- **`npx wrangler@4.149.0`.** It pins Wrangler but not the packages
  Wrangler needs, which could change between runs.
- **GitHub Pages.** The owner asked for Cloudflare. GitHub Pages also
  cannot send the security headers.
- **Uploading with `curl` alone.** The API that Wrangler uses to upload
  files is not documented as a public API.

## Consequences

- Before the first deploy, the owner sets up the `cloudflare` environment,
  the token and the account ID, from a phone
  ([site.md](../development/site.md#set-up-cloudflare)).
- Every push to `main` deploys, also when the site did not change.
  Wrangler uploads only files that Cloudflare does not have yet.
- Wrangler and the packages it needs run with the token. They are pinned
  and checked, and none of them runs while it is installed. A harmful
  version that was pinned anyway could misuse the token. The token reaches
  only Pages projects in the account. Users are told to compare the
  fingerprint with the one on GitHub.
- A Wrangler update is a new lockfile in a pull request. It is owner-only
  and flagged by the protected-paths workflow. Open: whether prompt R5
  ([PROMPTS.md](../development/PROMPTS.md)) should cover it.
- The account ID appears in the public run logs. It does nothing without a
  token.
- If Cloudflare ever retires Pages, the site moves to Workers with static
  assets. That needs a new record.
- Not tried before the first deploy: the token's permission, the real
  upload, and whether Cloudflare sends `_headers` exactly as written
  (section 17, "That the Cloudflare token works with the deploy tool").
  Deploy checks all three every time.
- Open: the hub's own domain, for example `shkriuss.app`. It is set in the
  Cloudflare dashboard. The workflow does not need to change for it.
- The `backend` workflow (section 13) decides about its own token in
  Phase 5.
- The generator is in [0022](0022-hub-site-generator.md).
