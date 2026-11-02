# Deployment

## How it works

```
pull request ──► CI checks
      │
   merge to main ──► CI checks ──► deploy every site ──► check the live sites
```

- **Hosting:** each site (the hub and every app) is its own Cloudflare
  Worker. It serves the site's files, and runs server code only for
  addresses that start with `/api/` (sync, the account, notifications,
  Photos' online library). A new app starts with files only. Requests for
  static files are free and unlimited on Cloudflare's Free plan.
- **Addresses:** each site's `wrangler.jsonc` has a _custom domain_
  (`shkriuss.app`, `tally.shkriuss.app`, …). On deploy, Cloudflare creates the
  DNS record and HTTPS certificate itself. The sites have no other address:
  `workers_dev` is off, and so is `preview_urls`, the addresses Cloudflare
  can give each version of a site. That also closes the 36 addresses where
  old builds of the hub, Calendar, Grammar, Photos and Tally stayed public
  (`1a2b3c4d-tally.shkriuss.workers.dev`, audit finding I-6): they served
  only old static files, never anyone's data.
- **Production:** `.github/workflows/ci.yml`. On every push to `main` it runs
  every check, then deploys the build it tested, one site at a time (two
  parts are made again at deploy time from the same pinned inputs, which
  gives the same result: each site's server code, which wrangler bundles,
  and Grammar's big model download), then checks that every live site shows
  the page that was deployed, with its security rules, and that its server
  answers.
- **No previews:** a pull request gets CI's checks, not preview links
  ([ADR 0019](adr/0019-no-pull-request-previews.md)). A preview ran a pull
  request's code, before it was merged, with a token that can change the
  live sites, and it was public. To see a change, look at the live site
  once it's merged; if something's wrong, roll back (below).
- **Storage for Photos' online library** ([ADR 0016](adr/0016-online-photo-library.md)):
  an R2 bucket, `shkriuss-photos`. `scripts/buckets.ts` creates it before
  deploying if it isn't there. At each production deploy,
  `scripts/deploy.ts` gives Photos' Worker the storage code as its secret
  `LIBRARY_STORAGE_CODE`.
- **The free plan's server storage:** each kind of storage of each site is a
  Durable Object namespace (33 today), and the free plan has 100 for the
  whole account. `tests/unit/free-plan.test.ts` checks they fit.

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

   The two `Account` permissions can't be limited to one zone: they reach
   every site in the Cloudflare account. If the account has other sites, a
   leaked token could change their Workers and buckets too. Keeping
   shkriuss.app in a Cloudflare account of its own avoids that (optional;
   audit 3 I-3).

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
2. **Settings** → **Secrets and variables** → **Actions**: delete any
   _repository_ secret named `CLOUDFLARE_API_TOKEN` or `PHOTOS_STORAGE_CODE`.
   Repository secrets reach every run, whatever its environment.
3. There's no other environment. If the list still has `preview` (from when
   pull requests had previews), or `claude` or `claude-audit` (from the
   Claude workflow, which was removed:
   [ADR 0021](adr/0021-no-claude-workflow.md)), delete them: `preview`
   holds a copy of the token, and the other two may hold a Claude API key.

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
`main` deploys: re-running an older run checks it but deploys nothing, and
no other run (an older one re-run, or one started with **Run workflow**)
can cancel the newest one's deploy while it waits its turn (audit 6 H-6).
**Re-run failed jobs** (or re-running only the deploy job) doesn't deploy:
it doesn't check again which commit is the newest, so its deploy stops at
once and says to use **Re-run all jobs** (it could otherwise cancel a newer
commit's deploy: audit 7 H-4, run 32).

GitHub starts no run for a commit whose message asks it to skip CI (words
like `[skip ci]` or `[no ci]`). A squash merge writes the pull request's
title, and its commits' messages or its description, into `main`'s commit,
so such words there would leave that commit undeployed. The **Checks** job
fails a pull request with them in its title, description or commits
(`scripts/skip-ci.ts`). Editing the title or description later isn't
checked again until the next push, so don't add them then. If a commit on
`main` does end up with no run while an older run is still going, that run
fails with "Nothing deploys main's newest commit" instead of quietly
leaving it to the newer one: merge another pull request to deploy it
(audit 7 H-5, run 32).

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
   Optional there: **Require branches to be up to date before merging**, so
   two pull requests that pass on their own can't be merged into a `main`
   that fails together (nothing deploys then until a fix is merged). Its
   cost: a pull request opened before another was merged needs **Update
   branch** and a new CI run first, Dependabot's too (audit 5 I-3).
4. **Settings → General → Features:** Wikis, Projects and Issues are off.
   Security reports come through private vulnerability reporting.
5. **Settings → General → Pull Requests:** keep only **Allow squash
   merging**, and tick **Automatically delete head branches**. In the `main`
   ruleset, set **Allowed merge methods** to **Squash** too.
6. Optional, in the `main` ruleset: **Require code scanning results**, with
   CodeQL and alerts **High or higher**; and under **Settings → Advanced
   Security → Secret Protection**, **Scan for non-provider patterns** and
   **Validity checks**, if they're offered.

### Domain and Cloudflare settings

These keep the domain yours and stop others from misusing it. They're found
in the Cloudflare dashboard (<https://dash.cloudflare.com>), mostly under
**shkriuss.app** (the zone). Each takes a few minutes, once (audit findings
I-1 to I-10).

1. **Keep the domain:** **Domain Registration → Manage Domains →
   shkriuss.app → Configuration → Auto renew: On.** Check under **Billing →
   Payment info** that the card on file won't expire before the renewal
   date. Without this, the domain lapses after a year and every app stops.
   Other domains in the same Cloudflare account have an auto-renew switch of
   their own: check each (audit 5 I-4).
2. **Say the domain sends no email**, so nobody can send convincing fake
   mail "from" shkriuss.app. **DNS → Records → Add record**, three times:
   - type `MX`, name `@`, mail server `.`, priority `0`;
   - type `TXT`, name `@`, content `v=spf1 -all`;
   - type `TXT`, name `_dmarc`, content
     `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s`.

   Leave **Email Routing** off. Two old rules that forwarded mail for
   `security@` and `support@` are still stored with it, but they do nothing
   while it's off, and Cloudflare's Email Routing page doesn't show a domain
   where it's off, so they can't be deleted there. Don't press **Onboard
   Domain** for shkriuss.app: that turns Email Routing on, and the two rules
   would forward mail again. If it's ever turned on, delete them first,
   under its **Routing rules** (audit 3 I-1). They can also be deleted
   while it's off, through Cloudflare's API, with a token that has _Email
   Routing Rules: Edit_ (`DELETE /zones/<zone>/email/routing/rules/<id>`
   for each, then the list call to confirm): ask Claude for that, in a
   session with such a token (audit 5 I-2). Security reports come through
   GitHub, as every site's `/.well-known/security.txt` says.

   Optional: the same `MX` and SPF records for each app's own address, like
   `tally.shkriuss.app`, since `sp=reject` covers only mail servers that
   check DMARC. For each app in
   [`apps.json`](../packages/registry/apps.json): type `MX`, name its slug
   (`tally`), mail server `.`, priority `0`; and type `TXT`, name its slug,
   content `v=spf1 -all` (audit 3 I-3).

3. **Only Cloudflare's certificate authorities may issue certificates:**
   **DNS → Records → Add record**, type `CAA`, name `@`, flags `0`, tag
   **Only allow specific hostnames**, three times, with `letsencrypt.org`,
   `pki.goog` and `ssl.com`. All three are needed: Cloudflare uses each of
   them for some of the sites' certificates. (Looked up from outside, the
   domain allows two more, `comodoca.com` and `digicert.com`: Cloudflare adds
   those itself, and they aren't in the zone's own records. That's
   expected.) Then **SSL/TLS → Edge
   Certificates → Certificate Transparency Monitoring: On**, which emails you
   when a certificate is issued for the domain.
4. **Nothing rewrites the pages:** turn off **SSL/TLS → Edge Certificates →
   Automatic HTTPS Rewrites** and **Security → Settings → Replace insecure
   JavaScript libraries**. Delete the site under **Analytics & Logs → Web
   Analytics**, and leave Zaraz and Rocket Loader off. The pages already
   work without them, and the security rules would block what they add. The
   live check after each deploy fails if a page has changed. Server-side
   Excludes, once under Scrape Shield, needs nothing: Cloudflare retired it
   in June 2024, so it has no switch, and the zone's old setting (the API
   still says `on`) does nothing. Cloudflare also answers `/robots.txt`
   with a text of its own on a site that has none; the build ships one for
   every site, so each serves its own (audit 5 I-1). If Cloudflare's text
   ever comes back, the switch is under **Security → Settings → Bot
   traffic** (its managed `robots.txt` for AI crawlers).
5. **Limit requests to the servers:** **Security → WAF → Rate limiting
   rules → Create rule**: "URI Path starts with `/api/`", 30 requests per 10
   seconds, action **Block**. It slows down a script trying to use up the
   free daily requests that all the apps share, but on the free plan it can't
   stop one: just under 3 requests a second from one address is never
   blocked, and is more than the 100,000 a day by the end of the day. So
   the servers keep what a stranger can make them do cheap, and a day of
   free requests used up only pauses the online features until 00:00 UTC
   (audit I-8).
6. **Account safety:** **Manage Account → Members → Enforce two-factor
   authentication: On.** And **Notifications → Add → Usage Based Billing →
   R2**: an alert when storage passes 20 GB, so unusual uploads show up before
   they cost anything. Optional: **Manage Account → Configurations → Zone
   Holds → shkriuss.app: On**, which stops anyone adding `shkriuss.app` as a
   zone in another Cloudflare account, on top of the registrar's transfer
   lock (audit 5 I-4).

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

## When a service CI needs is down

A deploy runs every check first, and they need a few outside services:
npm (the packages, installed again from scratch for the deploy itself),
Ubuntu's mirrors (the browser's system libraries) and GitHub. Playwright's
browser and Grammar's model come from CI's cache, so their download servers
(Playwright's, and Hugging Face) are needed only after an update, or when
the cache has gone: GitHub deletes a cache nobody has used for 7 days. The
**Keep caches** workflow (`.github/workflows/keep-cache.yml`) uses both
twice a week and downloads again whatever is missing, so a quiet week
doesn't empty them (audit 5 H-2); **Actions → Caches** on GitHub shows
what's there, and **Run workflow** on that workflow fills it by hand. If
one of these services is down while CI needs it, a merge (even a fix) can't
deploy until it's back: then open the newest **CI** run on `main` →
**Re-run all jobs**. Not **Re-run failed jobs**: the build the deploy uses
is kept for one day, so a day later only re-running everything (which
builds it again) can deploy (audit 6 H-9). The live sites stay as they were
meanwhile; to undo a bad deploy in the meantime, use the dashboard's
**Rollback** above (audit H-2).

## Costs

Everything here fits Cloudflare's and GitHub's free plans:

- Cloudflare Workers Free: static files are free and unlimited; up to 100
  Workers (so about 99 apps) and 100 custom domains per zone.
- GitHub Actions: free and unlimited on GitHub's standard machines, because
  the repository is public. (Private repositories get 2,000 minutes a month,
  which ran out, so it was made public on 22 October 2026.)
- Notifications while an app is closed, the optional account and sync use
  Durable Objects, free up to 100,000 requests a day (each notification sent
  is about two; signing in or opening the Account page takes a handful, and
  a device code shown to add a device takes one every 2 seconds, up to 300
  in its 10 minutes; an app with sync open uses about one a minute, plus one
  or two per change).
- Durable Objects also keep up to 5 GB, for every app together. Each app's
  servers have a limit, and copies nobody uses for 13 months are deleted
  ([ADR 0017](adr/0017-storage-limits.md)). A unit test checks that the
  limits of every app together stay under 4.5 GB (they're at 3.3 GB, the
  online library's lists included: room for about seven more apps with
  sync and notifications before the limits need lowering).
- Durable Objects also have 13,000 GB-s of time a day, counted while an
  object waits too. Push services are given 5 seconds to answer, and each
  second spent waiting counts against the app's 2,000 messages a day, so
  notifications can't use more than a small part of it
  ([ADR 0009](adr/0009-push-notifications.md)).
- Photos' online library uses R2: free up to 10 GB, then about $0.015 per GB
  a month (about $15 a month for 1 TB, the most it holds), and downloads are
  free. Reading files is free up to 10 million reads a month, far more than
  normal use; someone whose library has photos could make it about $40 a
  month at most ([ADR 0016](adr/0016-online-photo-library.md), "Reading from
  R2"). Each photo put online is one Worker request and four Durable Object
  requests. At most 10,000 photos go up a day, which takes at most about
  40,000 of the 100,000 free daily Durable Object requests that every app
  shares.
- The domain renewal, and R2 above 10 GB, are your only regular costs.

## Troubleshooting

| Problem                                                        | Fix                                                                                                                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy fails with "Add the CLOUDFLARE_API_TOKEN secret"        | Add it to the `production` environment (see setup).                                                                                                                           |
| Deploy fails with "Re-run all jobs"                            | Only some jobs were re-run. Open the newest **CI** run on `main` → **Re-run all jobs**.                                                                                       |
| A run fails with "Nothing deploys main's newest commit"        | That commit's message asked GitHub to skip CI, so it has no run. Merge another pull request (any small change) to deploy it.                                                  |
| Every pull request fails **Dependency audit**, nothing deploys | A new advisory in a dependency: [quality.md](quality.md#when-a-new-advisory-stops-every-merge) says how to go on.                                                             |
| Deploy fails with "Authentication error [code: 10000]"         | The token is missing a permission or the zone. Edit it in Cloudflare (**My Profile** → **API Tokens** → **Edit**) and check all three permission rows and both resource rows. |
| "Custom domain … already exists / conflicting DNS record"      | A DNS record already uses that name. Delete it in Cloudflare (**shkriuss.app** → **DNS** → **Records**) and re-run the workflow.                                              |
| A new app's address doesn't work right after the first deploy  | DNS and certificates can take a few minutes. The smoke test retries for about 5 minutes.                                                                                      |
| "Could not create the R2 bucket …"                             | Turn on R2 in Cloudflare, and give the token `Account` · `Workers R2 Storage` · `Edit` (see setup).                                                                           |
| Photos says "Online storage isn't set up yet"                  | Add the `PHOTOS_STORAGE_CODE` secret to the `production` environment (see setup). The next merge to `main` gives it to the Worker.                                            |
| An app keeps saying "Couldn't sync just now"                   | Its server may have reached its limit (ADR 0017); unused copies go after 13 months. To raise it: `STORAGE_LIMITS` in `packages/sync/src/worker.ts`, all under 5 GB.           |
