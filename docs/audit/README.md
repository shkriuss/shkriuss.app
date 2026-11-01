# Audit brief

This is the brief for anyone (a person or an AI tool) auditing this
repository and the live sites. Every auditor reads the same brief, checks one
**area** at a time and sends back a report in the same format, so that
reports from different tools can be compared and every finding can be checked.

The prompts to give each AI tool are in [prompts.md](prompts.md), and what
each audit found, and what happened to each finding, is in
[results.md](results.md).

## Rules for auditors

1. **Read only.** Don't change files, push branches, or open pull requests,
   issues or comments. The repository is public, so a finding posted on
   GitHub tells everyone about a problem before it's fixed. Send your report
   to the owner directly.
2. **Evidence, or it isn't a finding.** Each finding needs:
   - where it is (`path:line`);
   - a concrete way it goes wrong: what someone does, or what happens, and
     the result;
   - evidence: the code that shows it, or a command or test you ran and its
     output.

   If you couldn't confirm something, report it as a **suspicion**, and say
   what would confirm it.

3. **Read "Intentional choices" below first.** Report one of them only if you
   think its reasoning is wrong, and say concretely why. Also read the
   findings in [results.md](results.md) marked Explained, Accepted, By
   design or Your choice: report one again only if its reason is wrong.
4. **No style comments.** Prettier, ESLint, TypeScript and the size and CSP
   checks already run on every change. Report formatting, naming or personal
   preference only if it causes a real problem.
5. **Most serious first.** Anything that could lose or leak someone's data,
   let someone else in, or cost the owner money comes before everything else.
6. **Say what you checked.** List what you looked at and found fine, and what
   you didn't get to. A short report that's clear about its coverage is more
   useful than a long one that isn't.
7. **If you can run commands,** use them to prove findings: a small script,
   or a new test that fails, in your own workspace only. Setup: Node.js 24,
   pnpm 10 (`corepack enable`), then `pnpm install --frozen-lockfile`. Useful
   commands: `pnpm test` (unit tests), `pnpm typecheck`, `pnpm build`.
   `pnpm test:e2e` needs `pnpm build` first and Playwright's Chromium. The
   first `pnpm build` downloads Grammar's 361 MB model from Hugging Face;
   without it, build the rest with
   `pnpm -r --filter "./apps/*" --filter "!grammar" build`, and give
   `pnpm test:e2e` the other sites in `E2E_SITES`. More, like starting the
   local servers' data afresh: "Working on a computer" in
   [adding-an-app.md](../adding-an-app.md).

## What this is

- **The owner** is one person, a beginner, who works only from a phone or
  tablet. GitHub Actions builds, tests and deploys everything. Merging to
  `main` deploys to production.
- **15 sites**, each built with Astro into static HTML, CSS and JavaScript and
  hosted on Cloudflare Workers (static assets):
  - the hub at `shkriuss.app`, which lists the apps and has the Account and
    Privacy pages;
  - 14 apps, each at `<slug>.shkriuss.app`. The list is in
    [`packages/registry/apps.json`](../../packages/registry/apps.json).
- **Data stays on the device** by default, in `localStorage` and IndexedDB.
  It leaves the device only through these optional features, sealed on the
  device first (apart from what notifications need to be sent on time: their
  times, repeat pattern, time zone and push address):
  - **Account** (hub): links someone's devices, without email, password or
    name.
  - **Sync**: every app, through the account.
  - **Notifications while an app is closed:** Calendar, Habits, Tasks, Meals,
    Water, Reminders, Budget.
  - **Online photo library** in Cloudflare R2: Photos.
- **The server parts** are Workers and Durable Objects. A Worker runs only for
  `/api/*`; everything else is a static file.
- **Start reading here:**
  - [`CLAUDE.md`](../../CLAUDE.md): layout and rules;
  - [`docs/PLAN.md`](../PLAN.md): the plan;
  - [`docs/adr/`](../adr/): decisions and their reasons;
  - [`SECURITY.md`](../../SECURITY.md): the security summary;
  - [`docs/quality.md`](../quality.md): what's already checked automatically.

## Threat model

**What needs protecting:**

- People's data: notes, calendars, budgets, trades, photos, and the rest.
- The account secret, and the keys derived from it.
- The owner's Cloudflare bill, and their Cloudflare and GitHub accounts.
- The domain's reputation: no phishing or spam can use it.

**Who might attack, and how:**

| Who                                                 | What they can do                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Anyone on the internet                              | Call every `/api` route directly, with any input, as often as they like. They know the code, because the repository is public. |
| Cloudflare, or someone reading the servers' storage | See everything the Workers store and receive. They must see only sealed data, plus sizes, counts, times and IP addresses.      |
| Another website                                     | Link to, frame or send requests to our sites from someone's browser.                                                           |
| One of our own subdomains, if it were compromised   | Run code on `<slug>.shkriuss.app`. It must not be able to read another app's data or keys.                                     |
| A file someone imports                              | Calendar files (`.ics`), backups, photos (Exif) and data synced from another device are untrusted input.                       |
| A pull request from someone's fork, or a dependency | Try to run code in CI with secrets, or ship code to production (supply chain).                                                 |
| Someone with a person's unlocked, signed-in device  | Out of scope, except that "Replace the account key" must shut that device out, and "Delete all data" must delete it.           |
| An outside service we depend on                     | Hugging Face, npm, the push services or GitHub can fail, slow down or disappear. That mustn't stop a fix from being deployed.  |

**Security goals:**

1. The server, Cloudflare and the owner can't read anyone's data.
2. Only a person's own devices can read or change their data.
3. One app can't get another app's key or data.
4. Nobody can make the owner pay more than the limits in the ADRs.
5. Pages run only our own code, and load nothing from other websites.
6. "Delete" deletes, on the device and online.
7. Only code that passed every check in CI reaches production.
8. No stranger can lock people out of a feature (a limit that protects the
   bill must not let one person block everyone, except one app's storage
   limit, [ADR 0017](../adr/0017-storage-limits.md), and, for notifications
   while an app is closed, a day's messages for push addresses outside
   Google's, Apple's, Mozilla's and Microsoft's push services (UnifiedPush),
   and a day's test messages, [ADR 0009](../adr/0009-push-notifications.md);
   and the free daily requests all the apps' servers share: on the free plan
   a script can use them up, which pauses every app's online features until
   00:00 UTC, [deployment.md](../deployment.md) and
   [ADR 0010](../adr/0010-account-and-sync.md), "Free quota"), and no outside
   service can stop a fix from being deployed.

## Intentional choices

These are deliberate, and recorded in the ADRs. Report one only if its
reasoning is wrong, and say why.

- **Keys are kept in the browser's storage on the device, not encrypted**
  ([ADR 0010](../adr/0010-account-and-sync.md)). Encrypting them would need
  another key kept on the same device. Each app holds only its own key,
  derived from the account secret; only the hub holds the account secret.
- **No email, passwords or server-side list of accounts.** Losing every
  device and the recovery key means losing access to the online copy, by
  design.
- **Photos' storage code** ([ADR 0016](../adr/0016-online-photo-library.md))
  is a shared passphrase that stops strangers filling the owner's storage.
  It isn't a person's login: their key does that.
- **Notifications go through the browser's push service** (Google, Apple,
  Mozilla or Microsoft), encrypted ([ADR 0009](../adr/0009-push-notifications.md)). It's
  the only third party, and only for people who turn notifications on.
- **`'wasm-unsafe-eval'`** is in the CSP only for apps with
  `"webAssembly": true` (Grammar,
  [ADR 0011](../adr/0011-on-device-grammar-checking.md)).
- **No pull request previews**
  ([ADR 0019](../adr/0019-no-pull-request-previews.md)): nothing runs with
  the Cloudflare token before it's merged, so a change is first seen on the
  live site, and a revert undoes it.
- **The Cloudflare account ID** in the workflows isn't a secret.
- **The minimum TLS version is 1.3.** Very old devices can't connect.
- **No analytics, logs or error reporting** of any kind.
- **Durable Objects run on Cloudflare's free plan.** The limits in the ADRs
  keep normal use within it.
- **Each app's servers have a storage limit**
  ([ADR 0017](../adr/0017-storage-limits.md)). Someone determined can fill
  one app's room for a while, so new people can't turn on sync there, but
  nothing else stops. Copies nobody has used for 13 months are deleted.

## Areas

Audit one area per task. Each area says where to look and what to check, but
don't stop at these questions: anything else you find in the area counts.

### A. Keys, encryption and the account

**Where:**

- [`packages/crypto`](../../packages/crypto) and
  [`packages/account`](../../packages/account);
- the hub: [`account.ts`](../../apps/hub/src/scripts/account.ts),
  [`account.astro`](../../apps/hub/src/pages/account.astro) and
  [`worker.ts`](../../apps/hub/src/worker.ts);
- how an app gets its key, and where it keeps it:
  [`connect.ts`](../../packages/sync/src/connect.ts),
  [`origins.ts`](../../packages/sync/src/origins.ts) and
  [`device.ts`](../../packages/sync/src/device.ts);
- encrypted backups:
  [`backup.ts`](../../packages/storage/src/backup.ts);
- push encryption: [`encrypt.ts`](../../packages/push/src/encrypt.ts) and
  [`vapid.ts`](../../packages/push/src/vapid.ts);
- the online library: [`client.ts`](../../packages/library/src/client.ts);
- ADRs 0008, 0009, 0010, 0014 and 0016.

**Check:**

- Each key is derived for one purpose only (unique HKDF labels), and all
  randomness comes from `crypto.getRandomValues`.
- AES-GCM nonces are never reused with the same key. Labels or additional
  data tie each sealed value to its place, so a server can't swap, replay or
  roll back values unnoticed, or else the ADRs say plainly what it can do.
- Parsing of base64url, lengths and versions is strict, and nothing unsealed
  is trusted.
- The connect flow gives an app only its own key. Could another website,
  another of our apps, or a crafted link get a key, or turn sync on or off
  for someone? Look at origin checks, URL hash handling and redirects.
- Device links (QR code or link), passkeys (PRF) and the recovery key:
  - each is used once and expires quickly;
  - none can be replayed or guessed;
  - guessing is limited.
- Replacing the account key shuts the old key out everywhere: sync copies,
  synced photos and the online library (notifications while closed aren't
  tied to the account: ADR 0010, "Lost device").
- Encrypted backups:
  - how the key is derived from the passphrase (algorithm, iterations);
  - format checks;
  - what happens with a wrong passphrase.
- Servers compare secrets in constant time, and keep tokens only as hashes.

### B. Servers: Workers, Durable Objects and R2

**Where:**

- [`packages/server`](../../packages/server), including the storage meter
  (`meter.ts`);
- the Workers, each with its `validate.ts` next to it:
  - [`packages/sync/src/worker.ts`](../../packages/sync/src/worker.ts);
  - [`packages/library/src/worker.ts`](../../packages/library/src/worker.ts);
  - [`packages/push/src/worker.ts`](../../packages/push/src/worker.ts), plus
    `schedule.ts`;
  - [`packages/account/src/worker.ts`](../../packages/account/src/worker.ts);
- each app's `src/worker.ts` and `wrangler.jsonc`;
- ADRs 0009, 0010, 0014, 0016 and 0017.

**Check:**

- Everything a stranger can make a server keep goes through a meter, the
  limits add up to less than the free plan's 5 GB, and junk goes away by
  itself (or the ADR says why not).
- For every `/api` route:
  - who may call it, and what proves it;
  - what it accepts (size, shape, types) and what it returns;
  - what unknown routes and methods get.
- Can anyone on the internet:
  - read or change someone's data;
  - learn whether an account or library exists;
  - fill storage;
  - make the owner pay beyond the documented limits (R2 operations and
    storage, Durable Object requests and storage, Worker requests);
  - lock someone out, for example by using up the storage code's tries?
- Durable Objects:
  - races between requests at the same time (an `await` between a read and
    a write);
  - alarms;
  - half-finished work, such as a crash between an R2 upload and its commit;
  - whether deleting removes everything;
  - how storage grows over years.
- Requests from other websites are refused (`Sec-Fetch-Site`), there's no
  CORS, API answers are `Cache-Control: no-store`, and errors don't show
  internal details.
- Only `/api/*` runs the Worker (`run_worker_first`), so no static file can be
  replaced.
- Normal use can't reach the free plan's limits (Durable Objects, request
  body size, CPU time).

### C. Browser security on every site

**Where:**

- [`packages/astro-config`](../../packages/astro-config): `headers.ts`,
  `service-worker.ts`, `integration.ts` and `manifest.ts`;
- [`scripts/lib/dist-checks.ts`](../../scripts/lib/dist-checks.ts) (run by
  `scripts/check-dist.ts`) and
  [`tests/e2e/security.spec.ts`](../../tests/e2e/security.spec.ts);
- [`packages/ui`](../../packages/ui): its components, and the code that
  makes the Trusted Types policies
  ([`worker.ts`](../../packages/ui/src/scripts/worker.ts) and
  [`service-worker.ts`](../../packages/ui/src/scripts/service-worker.ts));
- every app's `src/scripts`;
- the parsers:
  - calendar import:
    [`ics-import.ts`](../../apps/calendar/src/lib/ics-import.ts);
  - Photos' Exif reading: [`exif.ts`](../../apps/photos/src/lib/exif.ts);
  - restoring backups: [`backup.ts`](../../packages/storage/src/backup.ts);
- every app's `public/on-demand/` downloads (today Grammar's Deep check,
  [ADR 0012](../adr/0012-deep-check-ai-model.md)).

**Check:**

- The CSP, Trusted Types and the other headers: is any way left to inject a
  script, and are the Trusted Types policies narrow?
- Can text from data, imports, URLs or other devices ever become any of
  these without checks:
  - HTML;
  - a URL (`href` or `src`, including `javascript:` and `data:`);
  - CSS;
  - a file name?
- Are imports, backups, photos and data synced from another device all
  treated as untrusted? Check for:
  - size limits;
  - broken input;
  - huge numbers;
  - `__proto__` keys in JSON;
  - slow regular expressions.
- The service worker:
  - what it caches and serves, and whether a bad response can get stuck;
  - updates and offline use;
  - its scope;
  - that it never caches `/api`.
- Our subdomains all belong to the same site (`shkriuss.app`). Is there any
  trust between them, through `postMessage`, shared storage or cookies?
- On-demand downloads are never precached, are downloaded only when the
  person asks, are checked by SHA-256 before use, and are at most 25 MiB per
  file. Only allowed apps compile WebAssembly.
- Downloads ("Save original", backups) have the right content types and safe
  file names.

### D. Privacy, and whether what we tell people is true

**Where:**

- the privacy page: [`privacy.astro`](../../apps/hub/src/pages/privacy.astro);
- `dataStored` in [`apps.json`](../../packages/registry/apps.json);
- [`README.md`](../../README.md), [`SECURITY.md`](../../SECURITY.md) and each
  app's README;
- the server parts (areas A and B);
- the data controls in `packages/ui` and `packages/storage`.

**Check:**

- Does every sentence on the privacy page, in `apps.json` and in the READMEs
  match what the code does? Is anything sent or kept that isn't mentioned, or
  promised that isn't true?
- What can Cloudflare, the push services and the owner learn: sizes, counts,
  times, IP addresses, which apps someone uses? Do we say so?
- Do "Delete all data" and "Delete the online copy" really delete
  everything? That means:
  - `localStorage`, IndexedDB and Cache Storage;
  - online copies and photo files;
  - notification subscriptions.
- Is there any request to another website anywhere? Check fonts, analytics,
  error reporting and referrers, including in manifests, icons and on-demand
  downloads.
- Is each site only at its own address, with no `workers.dev` address for it
  or for any single version of it?

### E. Data safety: storage, sync, backups and changes to data formats

**Where:**

- [`packages/storage`](../../packages/storage): `index.ts`, `files.ts` and
  `backup.ts`;
- [`packages/sync`](../../packages/sync): `merge.ts`, `client.ts` (the sync
  rounds), `device.ts` (this device's sync state), `files.ts` (photos),
  `edits.ts`, `requests.ts`, `request.ts` and `snapshot.ts`;
- [`packages/library/src/client.ts`](../../packages/library/src/client.ts) and
  [`apps/photos/src/scripts/online.ts`](../../apps/photos/src/scripts/online.ts);
- every app's data versions and migrations (`createStore` with `version`);
- [`packages/dates`](../../packages/dates).

**Check:**

- Can people lose data when:
  - storage is full, including iPhone's 5 MB per site, where some characters
    count twice;
  - they browse privately;
  - the browser clears storage? Safari deletes a site's data after 7 days
    without use unless it's on the Home Screen. Do we tell people, and do we
    ask for persistent storage?
  - two tabs are open;
  - the app crashes mid-save;
  - an old version of the app reads newer data;
  - a migration fails?
- Sync: could merges, deletes, "keep both", wrong clocks, devices offline for
  months, a replaced key, or turning sync off and on silently drop or
  resurrect data?
- Backups: does every app's backup restore exactly, edge values included?
  Does restoring a broken or old file fail safely?
- Dates: time zones, daylight-saving changes, month ends, leap years and the
  first day of the week.

### F. Each app does what it says

This area is split into three tasks:

- **F1, time and reminders:** Calendar, Reminders, Habits, Tasks, Water.
- **F2, numbers and money:** Budget, Trades, Repairs, Meals, Tally.
- **F3, the rest:** Notes, Shelf, Grammar, Photos and the hub.

**Where:** in each `apps/<slug>`:

- `src/lib` (the rules, with their tests);
- `src/scripts` (the page code);
- `src/pages`;
- `README.md`;
- `e2e/`.

**Check:**

- Do the rules do what the README and the page say? Try edge cases:
  - empty, one item, very many items;
  - very long text, emoji, non-Latin text;
  - zero, negative and very large numbers;
  - rounding and floating point, for money;
  - repeats and reminders across time zones and daylight-saving changes;
  - month and year ends.
- Does the page code use the rules correctly, and save what it shows?
- Do the tests check the real behaviour? Is important behaviour untested?

### G. Accessibility and interface quality

**Where:**

- [`packages/ui`](../../packages/ui): components and `styles/tokens.css`;
- each app's pages and scripts;
- [`tests/e2e/accessibility.spec.ts`](../../tests/e2e/accessibility.spec.ts);
- [`docs/quality.md`](../quality.md) and
  [`docs/design-system.md`](../design-system.md).

**Check:**

- WCAG 2.2 AA, beyond what axe finds:
  - focus order, and focus moving into dialogs and back out;
  - focus kept when a list is drawn again in the background (another tab,
    sync, a new day: `keepFocus`);
  - status messages announced;
  - names and labels;
  - error messages tied to their fields;
  - 44px tap targets;
  - 320px width and 200% zoom;
  - reduced motion, both themes, forced colours.
- Wording: plain and consistent, buttons that say what they do, and a
  confirmation before anything is destroyed.
- Behaviour offline, on slow networks, and when something fails.

### H. CI, deploys and the supply chain

**Where:**

- `.github/workflows/`, `.github/actions/setup`,
  `.github/actions/deep-check-model`, `.github/dependabot.yml` and
  `.github/zizmor/requirements.txt`;
- `scripts/`: `deploy.ts`, `buckets.ts`, `smoke-test.ts`,
  `new-app.ts`, `check-dist.ts` and `lockfile-age.ts`, with their logic in
  `scripts/lib/`;
- `apps/grammar/scripts/deep-check-files.ts`, which downloads Grammar's model
  during the build and checks its SHA-256;
- every `package.json`, plus `pnpm-workspace.yaml` (`catalog`,
  `minimumReleaseAge`, `onlyBuiltDependencies`) and `pnpm-lock.yaml`;
- `.gitleaks.toml` and `tests/unit/workflows.test.ts`;
- [`docs/deployment.md`](../deployment.md).

**Check:**

- Could any of these run code with secrets or write access?
  - a pull request from a fork;
  - a branch name, pull request title or issue;
  - a workflow input.

  Look for `pull_request_target`, `workflow_run`, artifacts passed between
  jobs, and `${{ }}` expressions inside `run:` scripts.

- Does each job have only the permissions it needs, and secrets only where
  needed? Is any secret printed, or written to a file that's uploaded?
- No workflow should run Claude or hold a Claude API key: the Claude
  workflow was removed ([ADR 0021](../adr/0021-no-claude-workflow.md)), and
  bringing one back needs a new ADR that keeps a pull request's code away
  from every token, key and `main`'s caches.
- Could a broken or malicious build reach production? Deploys should run
  only from `main`, after every check, using the same build that was tested.
- Can a pull request's own files (its `pnpm-lock.yaml`,
  `pnpm-workspace.yaml` or `package.json`) change what the lockfile check
  (`scripts/lockfile-age.ts`) reads or runs, or add a package it doesn't
  see? `main`'s copy runs first in its job, with `main`'s packages, and
  nothing from the pull request is installed there (audit 6 H-1). Look for
  YAML that pnpm (js-yaml) and the check (the `yaml` package) read
  differently: it refuses `<<` merge keys, keys written as lists, anchors,
  aliases, tags and directives (audit 6 H-2).
- For every dependency:
  - is it needed and maintained?
  - are install scripts allowed only where listed?
  - are actions pinned to full commit SHAs, and is the pin test strict?
  - is the lockfile consistent?
- Is anything secret in the repository or its history? Check that
  `.gitleaks.toml` doesn't allow too much.

### I. Domain, Cloudflare and GitHub settings

This area needs live access to the accounts. Without it, review
[`docs/deployment.md`](../deployment.md) against current best practice and
check what's public, such as DNS, certificates and the headers of every
subdomain.

**Check:**

- DNS: the records, DNSSEC and CAA.
- TLS settings and HSTS.
- Email: the domain sends none, so it should say so (SPF, DMARC, null MX) to
  stop spoofing.
- Unexpected certificates in certificate transparency logs (crt.sh).
- `/.well-known/security.txt`.
- Cloudflare:
  - Workers custom domains and `workers.dev`;
  - R2 public access;
  - API token permissions;
  - two-factor sign-in;
  - billing alerts;
  - the domain's auto-renew and lock.
- GitHub:
  - rulesets and Actions settings;
  - secret scanning, push protection, Dependabot and code scanning;
  - private vulnerability reporting;
  - installed GitHub Apps.
- Live headers and TLS on every subdomain, for example with Mozilla HTTP
  Observatory, SSL Labs and internet.nl.

### J. Architecture, maintainability, tests and docs

**Where:** everything. Start with `CLAUDE.md`, `docs/PLAN.md`, `docs/adr/` and
`packages/`.

**Check:**

- Is logic copied between apps that should be in a shared package? Are there
  files too large to work with? The largest files are Trades' rules
  (`apps/trades/src/lib/trades.ts`), the sync client
  (`packages/sync/src/client.ts`), Repairs' rules
  (`apps/repairs/src/lib/repairs.ts`), the online library's Worker
  (`packages/library/src/worker.ts`) and Tasks' page script
  (`apps/tasks/src/scripts/tasks.ts`), each about 1,000 to 1,100 lines;
  the largest test file is the sync client's (`client.test.ts`, about
  2,500 lines) (audit 5 J-7).
- Do the docs still match the code? Every AI session reads them before it
  works, so a wrong step there becomes a wrong change. Check each concrete
  claim (paths and names, commands, limits and numbers, steps, what a
  helper or component takes) in `CLAUDE.md`, `README.md`, `SECURITY.md`,
  the guides in `docs/`, the ADRs (what they say about how things work now,
  and whether a later change has its "Changed by" note), this brief,
  `prompts.md` and the pull request checklist. Also report what a newcomer
  would need that no doc mentions. A unit test (`tests/unit/docs.test.ts`)
  already checks that links and file paths exist, so look at what they say.
- Tests: important behaviour untested, tests that can't fail, and flaky
  patterns (timing, order).
- Performance:
  - page weight;
  - long lists;
  - IndexedDB use;
  - heavy work on the main thread.
- Browser support: Safari and iOS 16.4 and later (the owner's devices; push
  and sync need it), and current Chrome, Edge and Firefox. Anything newer
  needs a fallback or a feature check.
- What will be hard to change later, and why?

### Z. Anything else

Read anything, and report whatever looks wrong, risky or surprising that the
areas above don't cover.

## Severity

| Severity     | Meaning                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Critical** | Anyone can read or change other people's data, take over an account, run code on our sites, or run up large costs; or many people can lose data. |
| **High**     | The same, but only in unusual conditions; or some people can lose data in a realistic situation; or a secret can leak from CI.                   |
| **Medium**   | A real bug that harms people or weakens a protection, with a workaround.                                                                         |
| **Low**      | A small bug, a missing hardening step, or unclear text.                                                                                          |
| **Info**     | A suggestion with no defect.                                                                                                                     |

## Report format

Reply in Markdown, in this shape:

```markdown
# Audit report: <area letter and name>

- Tool and model: <for example, "Codex, GPT-…">
- Commit: <the commit SHA you read>
- Date: <YYYY-MM-DD>
- Could run commands: yes / no

## Findings

### <area>-1: <short title>

- Severity: Critical / High / Medium / Low / Info
- Confidence: confirmed / likely / suspicion
- Where: `path/to/file.ts:123` (and others)
- What's wrong: <one or two sentences>
- How it goes wrong: <concrete steps or input, and the result>
- Evidence: <code quoted, or the command or test you ran and its output>
- Suggested fix: <short>

(next finding…)

## Checked and found fine

- <what you checked, one line each>

## Not checked

- <what you didn't get to, and why>
```

Number the findings within your report (`A-1`, `A-2`, …). Put the most
serious first.

## What happens to reports

1. The owner passes each report to Claude, the main tool. They don't post it
   anywhere public.
2. Claude checks every finding against the code. It reproduces it with a test,
   or traces it step by step, before anything changes. A false alarm is noted
   with the reason.
3. When tools disagree about a serious finding, another tool is asked to
   prove or disprove it, and a test decides.
4. Fixes come as small pull requests, each with a test where possible.
5. Once everything is fixed, a public summary is added to
   [results.md](results.md): what was checked, by which tools, and what was
   found and fixed.
6. Each audit's numbers start again from 1, so the fixes name the audit too:
   the sixth audit's B-2 is "(audit 6 B-2)" in code comments and commits,
   and "6B-2" in results.md, which also says what the older numbers mean.
