# Deployment

## How it works

```
pull request ──► CI checks ──► preview links (pr-<n>-<site>.shkriuss.workers.dev)
      │
   merge to main ──► CI checks ──► deploy every site ──► check the live sites
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
- **Previews:** `.github/workflows/preview.yml`. Each pull request gets
  Cloudflare Worker Previews named `pr-<number>`. A bot comment lists the
  links, and they update on every push. They are deleted when the pull
  request closes. They're public but unlisted, and `workers.dev` tells search
  engines not to index them.
- **Storage for Photos' online library** ([ADR 0016](adr/0016-online-photo-library.md)):
  two R2 buckets, `shkriuss-photos` and `shkriuss-photos-preview` (for
  previews; its files are deleted after 7 days). `scripts/buckets.ts`
  creates them before deploying if they aren't there. At each deploy,
  `scripts/deploy.ts` and `scripts/previews.ts` give Photos' Worker the
  storage code as its secret `LIBRARY_STORAGE_CODE`.

## Setup (one time)

The workflows need two secrets: `CLOUDFLARE_API_TOKEN`, and
`PHOTOS_STORAGE_CODE` for Photos' online library. The account ID isn't
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

1. Open the repository on GitHub → **Settings** → **Secrets and variables**
   → **Actions**.
2. Tap **New repository secret**.
3. **Name:** `CLOUDFLARE_API_TOKEN`. **Secret:** paste the token. Tap
   **Add secret**.

Never paste the token anywhere else, including chat.

### Photos' online library

1. **Turn on R2:** Cloudflare dashboard → **R2 Object Storage** → **Purchase
   R2 Plan** (it asks for a payment method; the first 10 GB a month are
   free).
2. **The storage code:** make up a long passphrase (five random words is
   good) and keep it in your password manager. In GitHub, add a repository
   secret (as above) named `PHOTOS_STORAGE_CODE` with it. You type it once in
   Photos to let your account add photos online; without it, nobody (you
   included) can add to the online library, so nobody else can fill it on
   your bill.

To change the storage code, change the secret: the next deploy gives the
new one to the Worker. Libraries already unlocked stay unlocked.

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

## Rolling back

- **Easiest:** revert the pull request on GitHub (open the merged pull
  request → **Revert** → create and merge the revert pull request). CI
  deploys the previous version.
- **Fastest (one site):** Cloudflare dashboard → **Workers & Pages** → the
  site → **Deployments** → pick an earlier version → **Rollback**. The next
  merge to `main` deploys over it again.

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

| Problem                                                            | Fix                                                                                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deploy fails with "Add the CLOUDFLARE_API_TOKEN repository secret" | Do the setup above.                                                                                                                                                      |
| Deploy fails with "Authentication error [code: 10000]"             | The token is missing a permission or the zone. Edit it in Cloudflare (**My Profile** → **API Tokens** → **Edit**) and check both permission rows and both resource rows. |
| "Custom domain … already exists / conflicting DNS record"          | A DNS record already uses that name. Delete it in Cloudflare (**shkriuss.app** → **DNS** → **Records**) and re-run the workflow.                                         |
| A new app's address doesn't work right after the first deploy      | DNS and certificates can take a few minutes. The smoke test retries for about 5 minutes.                                                                                 |
| No preview links on a pull request                                 | Dependabot pull requests don't get previews (no secret access). Otherwise check the **Preview** workflow run.                                                            |
| "Could not create the R2 bucket …"                                 | Turn on R2 in Cloudflare, and give the token `Account` · `Workers R2 Storage` · `Edit` (see setup).                                                                      |
| Photos says "Online storage isn't set up yet"                      | Add the `PHOTOS_STORAGE_CODE` secret (see setup), then run the **CI** workflow again so the Worker gets it.                                                              |
