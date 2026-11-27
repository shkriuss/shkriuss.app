# Sync server

The server that the Sync app talks to: one Cloudflare Worker with a D1
database and an R2 bucket, in the user's own Cloudflare account. It
stores only ciphertext and is never trusted. Every byte of what it does
is in [sync-protocol.md](../architecture/sync-protocol.md).

- The code is [`backend/`](../../backend/), in TypeScript. Its licence
  is AGPL-3.0, in [`backend/LICENSE`](../../backend/LICENSE).
- The workflow is [`backend.yml`](../../.github/workflows/backend.yml).
- The tools are pinned in `.github/backend-tools/`, which is owner-only.
  The Worker's configuration, `wrangler.jsonc`, is there too: Wrangler
  runs whatever a configuration asks for, such as a build command, also
  in the step of the deploy that holds the token.
- Why it is built, tested and deployed this way:
  [ADR 0043](../adr/0043-backend-tools-tests-and-deploy.md). The
  protocol and the server: [ADR 0009](../adr/0009-sync-protocol-and-server.md).
- Nobody can use a server yet. The Sync app comes later.

## What is in `backend/`

| Path | What it is |
|---|---|
| `src/index.ts` | The Worker. It passes the bindings and the clock to the server. |
| `src/server.ts` | The router, and the checks of a signed request in their order |
| `src/calls/` | One file for each group of calls: `info`, joining and the account, the devices, the records, the files |
| `src/store.ts` | The D1 tables, the guard, and how D1's refusals become answers |
| `src/signatures.ts` | The bytes that are signed, and the two signature checks |
| `src/limits.ts` | Every number of the protocol that the server keeps to |
| `test/` | The tests, and `entry.ts`, the Worker the tests start |
| `check.sh` | The type check, both builds and every test |

### How the server keeps the protocol's "one step"

D1 runs each batch of statements as one step, but a Worker cannot keep
a step open while it decides. So:

1. Every query is one batch.
2. A call that reads, decides, then writes puts a guard first in its
   write batch. The guard is an insert into the view `guard`, whose
   trigger stops the batch unless the condition holds: for example, that
   the server's row is still the one that was read. Then D1 rolls the
   whole batch back, and the call starts again from its first read, at
   most three times.
3. A rule of the protocol that a write must keep, such as "only if the
   copy's number is at or below the cursor", is in the SQL of the write
   itself. The code checks afterwards that D1 did what the rule says.
4. The cap of 70,000 row writes of the day for a comparison of
   everything is a second view, `day_cap`, in the same write batch, after
   the day's count took the records that the batch stored. A batch over
   the cap stops whole and is answered `07 01`.

Blobs and IDs go into D1 as hex, through `unhex(?)`, and come out as
hex, through `hex(column)`. D1 hands a blob to a Worker as an array of
numbers, one for each byte. A string of hex costs far less CPU time.
The database stores the bytes themselves.

Every table is `WITHOUT ROWID`, and only `record` has a second index. So
a stored record costs two row writes and every other write one, as
"What the server stores" says. The tests assert the row writes of each
call from D1's own count.

## Run it in the cloud environment

Claude runs these before every push that changes `backend/`. Install
the pinned tools into `backend/`, once for each session:

```bash
bash .github/backend-tools/install.sh backend
```

Then the checks: the type check, the build of the Worker as it is
deployed, the build of the test Worker, and every test.

```bash
backend/check.sh
```

The tests start each server in Miniflare, with its own D1 database and
R2 bucket. They play devices with real P-256 and Ed25519 keys. They set
the server's clock through a header that only the test Worker reads.

## What the workflow does

| Job | Runs on | Secrets | Project code |
|---|---|---|---|
| Check the server | Pull requests that change `backend/`, its tools or the workflow, and every push to `main` | None | The type check, both builds and every test |
| Deploy the server | `main` only, environment `cloudflare` | `CLOUDFLARE_SYNC_API_TOKEN`, in one step | None |

Check the server installs the tools, runs `check.sh`, and notes the
SHA-256 of the built Worker. It is not a required check: it runs only
when a pull request changes the server.

Deploy the server:

1. stops unless its commit is still the newest on `main`;
2. ends with a notice, and deploys nothing, until the `cloudflare`
   environment has the token and the database ID;
3. checks out only `.github/backend-tools/`, with the tools and the
   Worker's configuration, and `backend/src`;
4. builds the Worker again, and stops unless it is byte for byte the one
   that Check the server tested;
5. puts the database ID in place of the zero ID of the configuration;
6. checks that the Worker exists;
7. uploads that Worker unchanged, as a new version, and deploys it;
8. checks what Wrangler reports, then asks the live server for `info`
   until it answers.

Its summary names the address, the version, and whether the server has
an account yet.

## Set up Cloudflare

Do this once, before the server is deployed. Only you can, because
Claude has no Cloudflare access and cannot change repository settings.
Until you do, every run on `main` ends with "The sync server is not set
up yet" and deploys nothing.

Of the labels of the Cloudflare dashboard in these steps, only the
token's scope and role are confirmed, from the site's set-up. Write down
any other label that differs, so Claude can fix this page.

| What | Kind | Where |
|---|---|---|
| The Worker `shkriuss-sync` | Made by you, by hand | Cloudflare dashboard |
| The D1 database `shkriuss-sync` | Made by you, by hand | Cloudflare dashboard |
| The R2 bucket `shkriuss-sync` | Made by you, by hand | Cloudflare dashboard |
| `CLOUDFLARE_SYNC_API_TOKEN` | Secret | Environment secret of the `cloudflare` environment on GitHub |
| `SYNC_D1_DATABASE_ID` | Not secret | Environment variable of the `cloudflare` environment on GitHub |
| `CLOUDFLARE_ACCOUNT_ID` | Not secret | Already there, for the site |

None of these values goes into the repository or a Claude session.

### 1. The Worker

The token may only edit this one Worker, and cannot create it. So you
make it first, empty.

1. Open `dash.cloudflare.com` in the browser and sign in.
2. Open **Workers & Pages** from the menu.
3. Tap **Create application**.
4. Tap **Start with Hello World!**, then **Get started**. Do not pick an
   option that connects a Git repository.
5. Name the Worker `shkriuss-sync`. Exactly this name: the workflow
   deploys only to it.
6. Tap **Deploy**.

The server's address is then
`https://shkriuss-sync.<your subdomain>.workers.dev`. It says "Hello
World!" until the first deploy.

### 2. The database

1. In the Cloudflare dashboard, open **Storage & databases**, then
   **D1 SQL database**.
2. Tap **Create database**.
3. Name it `shkriuss-sync`. Leave the location to Cloudflare.
4. Tap **Create**.
5. Copy the database's ID: 36 characters, digits, letters `a` to `f` and
   four hyphens. It is shown on the database's page.
6. Leave **Read replication** off. A copy in another region that lags
   behind would show a device an older head than it had seen.

The server makes its own tables on its first request. You add nothing to
the database.

### 3. The bucket

1. In the Cloudflare dashboard, open **R2 object storage**.
2. If Cloudflare asks you to turn on R2 first, follow its steps. It may
   ask for a payment method, also for the free plan. Write down what it
   asked, so Claude can fix this page.
3. Tap **Create bucket**.
4. Name it `shkriuss-sync`. Leave the location and the storage class as
   they are.
5. Tap **Create bucket**.

### 4. The token

It must be an account API token, not a user token, as for the site.

1. In the Cloudflare dashboard, open **Manage account**, then **Account
   API tokens**.
2. Tap **Create Token**. If Cloudflare offers templates, pick a custom
   token.
3. Name it `shkriuss.app sync deploy`.
4. Add one permission: **Workers**, with the scope **Specified
   Workers**. Pick `shkriuss-sync`. Pick the role **Editor**.
5. Add no other permission: no D1, no R2, no zone.
6. Leave **Client IP Address Filtering** empty. GitHub's runners have no
   fixed address.
7. Tap **Continue to summary**. Check that it shows only Editor on
   `shkriuss-sync`. Tap **Create Token**.
8. Copy the token. Cloudflare shows it only once. Never paste it into a
   Claude session.

### 5. The environment

1. Open `github.com/shkriuss/shkriuss.app/settings/environments` in the
   browser, and tap `cloudflare`.
2. Under **Environment secrets**, tap **Add environment secret**. Name:
   `CLOUDFLARE_SYNC_API_TOKEN`. Value: the token. Tap **Add secret**.
3. Under **Environment variables**, tap **Add environment variable**.
   Name: `SYNC_D1_DATABASE_ID`. Value: the database's ID. Tap **Add
   variable**.

The environment already lets only `main` use it, from the site's
set-up.

### 6. The first deploy

1. Open `github.com/shkriuss/shkriuss.app/actions/workflows/backend.yml`,
   tap **Run workflow**, leave the branch at `main` and tap **Run
   workflow**.
2. Wait for **Deploy the server** to finish. Its summary names the
   address, the version, and "The server answers info: no account yet."
3. Write down anything that did not match these steps, so Claude can fix
   this page.

The setup code, the Worker's secret `SETUP_CODE`, comes later: the Sync
app shows it when the first phone joins, and says where to save it.

## When Deploy the server fails

Tap the failed step to see the message.

| Message | What to do |
|---|---|
| The cloudflare environment has no secret CLOUDFLARE_SYNC_API_TOKEN. | Add it ([The environment](#5-the-environment), step 2). |
| The cloudflare environment needs the variable SYNC_D1_DATABASE_ID ... | Add it, or check that it is the database's ID exactly ([The environment](#5-the-environment), step 3). |
| The cloudflare environment needs the variable CLOUDFLARE_ACCOUNT_ID ... | It is the site's. Check it ([site.md](site.md#4-the-environment), step 5). |
| The Worker shkriuss-sync does not exist. ... | Create it ([The Worker](#1-the-worker)). The name must be exactly `shkriuss-sync`. |
| The token cannot reach the Worker shkriuss-sync. ... | The token is wrong: expired, for another account, a user token, or without Editor on `shkriuss-sync`. Make a new one ([The token](#4-the-token)) and replace the secret. |
| A Wrangler error that names D1, R2, a binding, "Authentication error" or code 10000 | Cloudflare may want more than Editor on the Worker to deploy it with its database and bucket. Ask Claude, with the message. Do not widen the token on a guess. |
| The Worker built here is not the one the job Check the server tested. | Nothing was deployed. Run the workflow again. If it happens again, ask Claude. |
| ... did not answer as the sync server within two minutes. | The new version may need longer, or the address is wrong. Run the workflow again. If it happens again, ask Claude. |
| A newer commit is on main. | Not an error. The newer commit's run deploys. |

To stop the server at once, open the Worker in the Cloudflare dashboard.
In **Deployments**, roll back to an older version. Or, under
**Settings**, **Domains & Routes**, turn off the `workers.dev` address.

## Update the tools

The files in `.github/backend-tools/` are owner-only. Claude changes them
only when you ask for exactly that.

1. Keep Wrangler at the site's version, so that both lockfiles hold the
   same packages ([Update Wrangler](site.md#update-wrangler)). Pick
   `@cloudflare/workers-types` at the version that Wrangler asks for, and
   TypeScript at a release more than a month old.
2. Change the versions in `.github/backend-tools/package.json`.
3. In `.github/backend-tools/`, run
   `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`.
   It rewrites `package-lock.json`.
4. Check that `install.sh` installs them:
   `bash .github/backend-tools/install.sh backend`. It installs only from
   the lockfile, and stops on a checksum that differs from it.
5. Run `backend/check.sh`, then open a pull request. The job **Check the
   server** installs and checks them again on GitHub.
