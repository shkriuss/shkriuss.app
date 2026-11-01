# Hub

The front page, at <https://shkriuss.app>: the list of apps, the privacy
page, and the Account page for the optional shkriuss account.

- `src/pages/index.astro`: the list of apps, read from
  [`packages/registry/apps.json`](../../packages/registry/apps.json) (never
  typed in here).
- `src/pages/privacy.astro`: what each app keeps and where. It's built from
  each app's `storage` and `dataStored` in `apps.json`, so a new app is
  listed by itself; its own text (like "two days" or "13 months") repeats
  numbers from the code, so update it when they change. When its text
  changes, so does its "Last updated" date: `src/privacy.test.ts` keeps a
  fingerprint of the text next to the date, and fails until both are
  updated, saying what to set. That's the day the text was written; the
  page shows the day it was merged, so went live, when that's later
  (`src/lib/last-updated.ts` asks git, which is why CI's Checks job fetches
  the whole history; audit 6 D-2).
- `src/pages/account.astro` and `src/scripts/account.ts`: the Account page.
  The account itself is in `packages/account`
  ([ADR 0010](../../docs/adr/0010-account-and-sync.md)).
- `src/worker.ts`: runs the account service (`/api/account/*`) from
  `packages/account`; everything else is the built site.
- `e2e/`: browser tests for the list of apps and the Account page. The
  shared accessibility, security and offline checks in `tests/e2e/` run
  here too.

Only the hub may use passkeys (`allowFeatures` in `astro.config.ts`): they
belong to `shkriuss.app`, and apps are refused them.
