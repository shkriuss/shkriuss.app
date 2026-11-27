# 0043 The sync server's tools, tests and deploy

- Status: Accepted
- Date: 2026-11-27
- Source: the owner's four choices for Phase 5, step 2, the build of
  `backend/` ([PROMPTS.md](../development/PROMPTS.md)), on 2026-11-27,
  and the owner's sentence in the same session: "I am the owner and I
  ask you to add the workflow .github/workflows/backend.yml, which
  checks backend/ on pull requests and deploys it from main with the
  cloudflare environment, and the folder .github/backend-tools/ that
  pins its tools, and nothing else in .github/." The details are
  Claude's, in the pull request of that step.

## Context

- The sync server is one Cloudflare Worker with D1 and R2
  ([0009](0009-sync-protocol-and-server.md)). Its code is in `backend/`.
  What it does is in
  [sync-protocol.md](../architecture/sync-protocol.md).
- Hard rule 5 of [CLAUDE.md](../../CLAUDE.md): a tool outside Gradle is
  pinned with a lockfile and checksums in an owner-only folder, and
  needs a decision record.
- The site already deploys with Wrangler 4.156.2, pinned in
  `.github/site-deploy/` ([0023](0023-hub-site-hosting-and-deploy.md)).
  Wrangler 4.156.2 brings Miniflare 5.20261102.0-beta and workerd
  1.20261102.1: Cloudflare's own runtime, run locally, with D1 and R2.
- The protocol asks that a test asserts the row writes of each call
  from D1's own count ("What the tests must cover", point 10).
- A token can be limited to one Worker, with the role Editor. It can
  deploy that Worker and cannot create or delete one (0023). Cloudflare's
  documentation does not say whether such a token may deploy a Worker
  that has D1 and R2 bindings.
- TypeScript 7.0.2 is a program written in Go, shipped as 20 packages,
  one for each platform. TypeScript 6.0.3 is one package with no
  dependencies.
- Wrangler 4.156.2 asks for `@cloudflare/workers-types` 5.20261102.1 or
  newer, the version of its workerd. That version was 25 days old.
- Claude has no Cloudflare access.

## Decision

1. Decided by the owner: the server is written in TypeScript. Wrangler
   builds it. `tsc` only checks it.
2. Decided by the owner: the tests run with Node's own test runner. They
   start the Worker in Miniflare, with its own D1 database and R2 bucket.
   - Each test starts a fresh server.
   - They start a test Worker, `backend/test/entry.ts`: the same server,
     plus a clock that the test sets and D1's own count of the row
     writes of each request. It is never deployed.
   - One test also starts the Worker exactly as it is deployed.
3. The tools are pinned in `.github/backend-tools/`, which is
   owner-only:
   - Wrangler 4.156.2, the version of the site, with the same packages
     as the site's lockfile;
   - TypeScript 6.0.3, not 7.0.2, because it is one package with no
     dependencies;
   - `@cloudflare/workers-types` 5.20261102.1, the version Wrangler
     4.156.2 asks for. It is an exception to the habit of pinning
     versions more than a month old, as Wrangler 4.156.2 was in 0023.
   - `package-lock.json` pins every package with its SHA-512 checksum,
     all from `https://registry.npmjs.org/`. `install.sh` checks both,
     then installs with `npm ci --ignore-scripts --engine-strict`, as the
     site's does.
4. Decided by the owner: the deploy token reaches one Worker only, as
   for the site.
   - The user makes the Worker `shkriuss-sync`, the D1 database
     `shkriuss-sync` and the R2 bucket `shkriuss-sync` by hand, once.
   - The token is an account API token with Editor on the Worker
     `shkriuss-sync` only. It is the secret `CLOUDFLARE_SYNC_API_TOKEN`
     of the `cloudflare` environment. The database's ID is its variable
     `SYNC_D1_DATABASE_ID`. The account ID is its variable
     `CLOUDFLARE_ACCOUNT_ID`, which the site uses too.
   - No token reaches D1 or R2. The Worker makes its own tables on its
     first request, and moves them forward on its first request after a
     deploy. Its row in D1 holds the version of its tables.
5. The workflow [`backend.yml`](../../.github/workflows/backend.yml) has
   two jobs:

   | Job | Runs on | Secrets | Project code |
   |---|---|---|---|
   | Check the server | Pull requests that change `backend/`, its tools or the workflow, and every push to `main` | None | The type check, both builds and every test |
   | Deploy the server | `main` only, environment `cloudflare` | `CLOUDFLARE_SYNC_API_TOKEN`, in one step | None. Wrangler builds the Worker from its source |

6. Deploy the server:
   1. stops unless its commit is still the newest on `main`;
   2. ends with a notice, and deploys nothing, while the `cloudflare`
      environment has neither the token nor the database ID;
   3. checks out only the tools, `backend/src` and
      `backend/wrangler.jsonc`;
   4. builds the Worker again, and stops unless it is byte for byte the
      one that Check the server tested;
   5. puts the database ID in place of the zero ID of
      `wrangler.jsonc`, and checks that only that line changed;
   6. checks that the Worker exists, as the site's Deploy does;
   7. uploads that Worker unchanged (`wrangler deploy --no-bundle`), with
      no routes and no custom domains;
   8. stops unless Wrangler reports the same Worker, a new version and
      its `workers.dev` address;
   9. asks the live server for `info` until it answers as this server
      does.
7. Decided by the owner: the measurement of CPU time on a deployed
   Worker ([sync-protocol.md](../architecture/sync-protocol.md#the-free-plan),
   point 8) comes in a pull request of its own, after the first deploy.
   Until then `info` names the protocol's own limits. No device can use
   a server before the Sync app exists.
8. The Worker logs nothing: Cloudflare's Workers Logs and Logpush are off
   in `wrangler.jsonc`, and the code writes no log.

## Options rejected

- **Cloudflare's Vitest pool for Workers.** Cloudflare's recommended way,
  with the same runtime. It adds Vitest, Vite and their packages. The
  owner chose Miniflare.
- **Stand-ins of our own for D1 and R2.** No package at all, but D1's own
  count of row writes and its batches could not be tested.
- **JavaScript.** No type checker. The owner chose TypeScript.
- **A token with rights to D1 and R2, and Wrangler's D1 migrations.** The
  token would reach every database and bucket of the account. The owner
  chose a token for one Worker.
- **TypeScript 7.0.2.** Twenty packages instead of one.
- **Types that Wrangler writes (`wrangler types`).** A generated file of
  its own to keep or to make before each check. The owner chose the
  package.
- **Deploying a build that the job Check the server uploads.** That job
  runs the tests, which are project code, on the same runner. Building
  again from `main` with the pinned tools, and comparing, deploys what
  `main` holds, whatever a test did.
- **Measuring CPU time in this pull request.** The owner chose a pull
  request of its own.

## Consequences

- Before the first deploy, the owner makes the Worker, the database, the
  bucket and the token, and saves the secret and the variable, from a
  phone ([backend.md](../development/backend.md#set-up-cloudflare)).
  Until then every run on `main` says that the server is not set up.
- The first deploy shows whether a token for one Worker may deploy it
  with its D1 and R2 bindings. If Cloudflare refuses, the token is not
  widened on a guess: the choice comes back to the owner.
- Wrangler, Miniflare and workerd run in the tests. workerd is a native
  program, but it runs only on the build machine. Nothing of it reaches
  an app or the Worker. Hard rule 2 is about the apps.
- An update of a tool is a new lockfile in `.github/backend-tools/`. It
  is owner-only and flagged by the protected-paths workflow. GitHub
  reads the lockfile for security alerts by itself.
- The tests do not measure CPU time. The measurement sets the limits of
  `info` ([sync-protocol.md](../architecture/sync-protocol.md#the-free-plan)).
- A user who forks the repository to run a server of their own sets up
  the same names in their own Cloudflare account and their own
  `cloudflare` environment. The self-hosting guide, `docs/self-hosting/`,
  comes with the Sync app.
- The server's code is AGPL-3.0, with its licence file in `backend/`
  ([0018](0018-licences.md)).
