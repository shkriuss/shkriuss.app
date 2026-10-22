# Deployment

## How it works

```
pull request ──► CI checks
      │       └──► (when you approve) preview links (pr-<n>-<site>.shkriuss.workers.dev)
      │
   merge to main ──► CI checks ──► deploy every site ──► check the live sites
                                                      └──► delete previews of closed pull requests
```

- **Hosting:** each site (the hub and every app) is its own Cloudflare Worker
  that serves only static files. Requests for static files are free and
  unlimited on Cloudflare's Free plan.
- **Addresses:** each site's `wrangler.jsonc` has a _custom domain_
  (`shkriuss.app`, `tally.shkriuss.app`, …). On deploy, Cloudflare creates the
  DNS record and HTTPS certificate itself. `workers.dev` addresses are off for
  production.
- **Production:** `.github/workflows/ci.yml`. On every push to `main` it runs
  every check, then deploys the exact files it tested, one site at a time,
  then checks that every live site answers with the right security headers.
- **Previews:** `.github/workflows/preview.yml`. A pull request gets
  Cloudflare Worker Previews named `pr-<number>` once you approve them (see
  "Seeing a preview" below). A bot comment lists the links. They're public
  but unlisted, and `workers.dev` tells search engines not to index them.
  Previews of closed pull requests are deleted by the next production
  deploy.
  - **Why approval:** the Cloudflare token can change production too, and a
    preview runs the pull request's own code before anyone has merged it.
    So the token is kept in an environment that waits for you.
  - Previews get no storage code, so Photos' online library stays locked in
    them.
- **Storage for Photos' online library** ([ADR 0016](adr/0016-online-photo-library.md)):
  two R2 buckets, `shkriuss-photos` and `shkriuss-photos-preview` (for
  previews; its files are deleted after 7 days). `scripts/buckets.ts`
  creates them before deploying if they aren't there. At each production
  deploy, `scripts/deploy.ts` gives Photos' Worker the storage code as its
  secret `LIBRARY_STORAGE_CODE`.

## Setup (one time)

The workflows need two secrets: `CLOUDFLARE_API_TOKEN`, and
`PHOTOS_STORAGE_CODE` for Photos' online library. They're kept in GitHub
_environments_, which decide which runs may use them. The account ID isn't
secret, so it's written in the workflows.

### Create the Cloudflare API token

1. Go to <https://dash.cloudflare.com/profile/api-tokens> (**My Profile** →
   **API Tokens**).
2. Tap **Create Token**, then next to **Create Custom Token** tap
   **Get started**.
3. **Token name:** `github-actions-deploy`.
4. **Permissions** (tap **+ Add more** for each extra row):
   - `Account` · `Workers Scripts` · `Edit`
   - `Account` · `Workers R2 Storage` · `Edit` (to create Photos' buckets)
   - `Zone` · `Workers Routes` · `Edit`
5. **Account Resources:** `Include` · `shkriuss` (your account).
6. **Zone Resources:** `Include` · `Specific zone` · `shkriuss.app`.
7. Leave IP filtering empty. TTL: optional (if you set an end date, set a
   calendar reminder to replace the token before it expires).
8. Tap **Continue to summary** → **Create Token**, then copy the token.
   It's shown only once.

### Save it in GitHub

Open the repository on GitHub → **Settings** → **Environments**.

1. **New environment**, named `production`:
   - **Deployment branches and tags** → **Selected branches and tags** →
     **Add deployment branch or tag rule** → `main`. Only runs on `main` can
     use this environment.
   - **Environment secrets** → **Add environment secret**: name
     `CLOUDFLARE_API_TOKEN`, value: the token.
2. **New environment**, named `preview`:
   - Tick **Required reviewers**, add yourself, and tap **Save protection
     rules**. Leave **Prevent self-review** off.
   - **Environment secrets** → **Add environment secret**: name
     `CLOUDFLARE_API_TOKEN`, value: the same token. Never the storage code.
3. **Settings** → **Secrets and variables** → **Actions**: delete any
   _repository_ secret named `CLOUDFLARE_API_TOKEN` or `PHOTOS_STORAGE_CODE`.
   Repository secrets reach every run, whatever its environment.

Never paste the token anywhere else, including chat.

### Photos' online library

1. **Turn on R2:** Cloudflare dashboard → **R2 Object Storage** → **Purchase
   R2 Plan** (it asks for a payment method; the first 10 GB a month are
   free).
2. **The storage code:** make up a long passphrase of five or more random
   words (a password manager's "passphrase" generator does this; not a
   sentence you'd say, at least 24 characters, or the deploy warns) and keep
   it in your password manager. In GitHub, add it as a secret
   of the `production` environment (as above), named `PHOTOS_STORAGE_CODE`.
   You type it once in
   Photos to let your account add photos online; without it, nobody (you
   included) can add to the online library, so nobody else can fill it on
   your bill.

To change the storage code, change the secret: the next deploy gives the
new one to the Worker. To deploy again without merging anything, open the
newest **CI** run on `main` → **Re-run all jobs**. Only the newest commit on
`main` deploys: re-running an older run checks it but deploys nothing.

### GitHub settings

The repository is public, so CI is free, and anyone can read the code (never
the secrets). On github.com (some settings are easier to find on the desktop
version of the site):

1. **Settings → Advanced Security** (or **Code security**): turn on
   **Private vulnerability reporting**, **Dependabot alerts**, **Dependabot
   security updates**, **Secret Protection** with **Push protection**, and
   **Code scanning → CodeQL → Default setup**.
2. **Settings → Actions → General:**
   - Fork pull request workflows from outside collaborators: **Require
     approval for all external contributors**, so nobody else's code runs in
     CI until you allow it.
   - Workflow permissions: **Read repository contents and packages
     permissions**, and untick **Allow GitHub Actions to create and approve
     pull requests** (the workflows ask for anything more themselves).
   - If it's there, tick **Require actions to be pinned to a full-length
     commit SHA** (ours all are).
3. **Settings → Rules → Rulesets → New branch ruleset:** name `main`,
   **Active**, target the **default branch**, and tick **Restrict deletions**,
   **Block force pushes**, **Require a pull request before merging** (0
   approvals: you can't approve your own) and **Require status checks to
   pass** with **Checks**, **Secret scan** and **Dependency audit**.
4. **Settings → General → Features:** Wikis, Projects and Issues are off.
   Security reports come through private vulnerability reporting.

## Seeing a preview

Open the pull request, scroll to its checks, and tap **Deploy previews** (it
says it's waiting). Tap **Review deployments**, tick **preview**, and tap
**Approve and deploy**. A few minutes later the bot comment lists the links.
Each later push waits for approval again. A pull request you don't need to
look at doesn't need approving: merging doesn't wait for previews.

Approve only pull requests you trust: the preview runs that pull request's
code with the Cloudflare token.

## Rolling back

- **Easiest:** revert the pull request on GitHub (open the merged pull
  request → **Revert** → create and merge the revert pull request). CI
  deploys the previous version.
- **Fastest (one site):** Cloudflare dashboard → **Workers & Pages** → the
  site → **Deployments** → pick an earlier version → **Rollback**. The next
  merge to `main` deploys over it again.
- **Don't roll back past a change to how an app saves its data** (a pull
  request that raised a store's `version` and added a migration). Fix
  forward instead. Anyone who opened the newer version has their data saved
  in the new shape, which the older version can't read: it keeps that data
  safe, but shows nothing, and can't save or sync, until the newer version
  is back.

## Costs

Everything here fits Cloudflare's and GitHub's free plans:

- Cloudflare Workers Free: static files are free and unlimited; up to 100
  Workers (so about 99 apps) and 100 custom domains per zone.
- GitHub Actions: free and unlimited on GitHub's standard machines, because
  the repository is public. (Private repositories get 2,000 minutes a month,
  which ran out, so it was made public on 22 October 2026.)
- Notifications while an app is closed, the optional account and sync use
  Durable Objects, free up to 100,000 requests a day (each notification sent
  is about two; signing in, adding a device or opening the Account page
  takes a handful; an app with
  sync open uses about one a minute, plus one or two per change).
- Photos' online library uses R2: free up to 10 GB, then about $0.015 per GB
  a month (about $15 a month for 1 TB, the most it holds), and downloads are
  free. Each photo put online is one Worker request and two Durable Object
  requests; at most 20,000 photos go up a day, so the free daily requests
  last for every app.
- The domain renewal, and R2 above 10 GB, are your only regular costs.

## Troubleshooting

| Problem                                                       | Fix                                                                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy fails with "Add the CLOUDFLARE_API_TOKEN secret"       | Add it to the `production` environment (see setup).                                                                                                                           |
| Deploy fails with "Authentication error [code: 10000]"        | The token is missing a permission or the zone. Edit it in Cloudflare (**My Profile** → **API Tokens** → **Edit**) and check all three permission rows and both resource rows. |
| "Custom domain … already exists / conflicting DNS record"     | A DNS record already uses that name. Delete it in Cloudflare (**shkriuss.app** → **DNS** → **Records**) and re-run the workflow.                                              |
| A new app's address doesn't work right after the first deploy | DNS and certificates can take a few minutes. The smoke test retries for about 5 minutes.                                                                                      |
| No preview links on a pull request                            | Previews wait for your approval (see "Seeing a preview"). Dependabot's pull requests never get previews.                                                                      |
| "Could not create the R2 bucket …"                            | Turn on R2 in Cloudflare, and give the token `Account` · `Workers R2 Storage` · `Edit` (see setup).                                                                           |
| Photos says "Online storage isn't set up yet"                 | Add the `PHOTOS_STORAGE_CODE` secret to the `production` environment (see setup). The next merge to `main` gives it to the Worker.                                            |
