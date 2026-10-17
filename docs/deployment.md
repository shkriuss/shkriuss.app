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

## Setup (one time)

The workflows need one secret, `CLOUDFLARE_API_TOKEN`. The account ID isn't
secret, so it's written in the workflows.

### Create the Cloudflare API token

1. Go to <https://dash.cloudflare.com/profile/api-tokens> (**My Profile** →
   **API Tokens**).
2. Tap **Create Token**, then next to **Create Custom Token** tap
   **Get started**.
3. **Token name:** `github-actions-deploy`.
4. **Permissions** (tap **+ Add more** for the second row):
   - `Account` · `Workers Scripts` · `Edit`
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
- GitHub Actions on a private repo: 2,000 free minutes per month. A pull
  request uses roughly 4–6 minutes per push and a deploy about 3. If the
  minutes run out, workflows pause until next month. You're never charged
  unless you add a payment method and raise the spending limit.
- Notifications while an app is closed use Durable Objects, free up to
  100,000 requests a day (each notification sent is about two).
- The domain renewal is your only regular cost.

## Troubleshooting

| Problem                                                            | Fix                                                                                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deploy fails with "Add the CLOUDFLARE_API_TOKEN repository secret" | Do the setup above.                                                                                                                                                      |
| Deploy fails with "Authentication error [code: 10000]"             | The token is missing a permission or the zone. Edit it in Cloudflare (**My Profile** → **API Tokens** → **Edit**) and check both permission rows and both resource rows. |
| "Custom domain … already exists / conflicting DNS record"          | A DNS record already uses that name. Delete it in Cloudflare (**shkriuss.app** → **DNS** → **Records**) and re-run the workflow.                                         |
| A new app's address doesn't work right after the first deploy      | DNS and certificates can take a few minutes. The smoke test retries for about 5 minutes.                                                                                 |
| No preview links on a pull request                                 | Dependabot pull requests don't get previews (no secret access). Otherwise check the **Preview** workflow run.                                                            |
