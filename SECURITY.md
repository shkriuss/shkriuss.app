# Security

## Reporting a problem

If you find a security or privacy problem in shkriuss.app or any of its apps,
please report it privately, and don't share it publicly first: on GitHub, open
this repository's **Security** tab and choose **Report a vulnerability**. Only
the owner sees the report.

## Security model (summary)

The full reasoning is in [docs/PLAN.md](docs/PLAN.md#4-security-and-privacy-model)
and [ADR 0004](docs/adr/0004-security-headers.md).

**What runs where**

- Every site's pages and files are static files on Cloudflare Workers
  static assets. Worker code runs only for `/api/*`, for these optional
  features.
- Apps that offer **notifications while
  closed** (`"pushNotifications": true` in `apps.json`: Calendar, Habits,
  Tasks, Meals, Water, Reminders and Budget) also run a small Worker for
  `/api/push/*`, with one
  Durable Object per device ([ADR 0009](docs/adr/0009-push-notifications.md)).
  It only ever holds messages encrypted on the user's device, delivery times
  and a time zone; each app has its own storage and signing key, generated
  by the server and never exported. Requests are size-limited, rate-limited
  and checked; push addresses must be https with a domain name, and
  redirects are refused. A device whose messages all fail or are refused for
  two days is forgotten, and each app sends at most 2,000 messages a day.
- The hub also runs a small Worker for `/api/account/*`, for the optional
  **shkriuss account** ([ADR 0010](docs/adr/0010-account-and-sync.md)). It
  only holds values sealed on the device (AES-256-GCM): passkey locks, under
  the hash of a token only the passkey can produce, and one-time device links
  that expire after 10 minutes (or when the device showing the code is done
  with it). A lock keeps its passkey's public key, and is only handed out or
  removed for the passkey's signature made on the Account page itself, so
  an app's page can't use the passkey to get it, in any browser
  ([ADR 0018](docs/adr/0018-passkey-signatures.md)). It also notes account
  keys that were replaced (after a lost device), under the hash of a token
  only the old key can make; devices holding a replaced key sign out, and it
  can't sign in again. There are no account ids, emails or passwords.
  Requests from other sites are refused (`Sec-Fetch-Site`), and bodies are
  limited to 1 KB (4 KB for passkeys' signatures).
- Apps that can **sync** (`"sync": true` in `apps.json`) run `/api/sync/*` in their own
  Worker, with one Durable Object per account holding one copy of the app's
  data, sealed on the device (AES-256-GCM, compressed first). The account is
  found by the SHA-256 hash of a token derived for that app, so copies in
  different apps can't be linked. Uploads must name the version they were
  based on, so a stale device can't overwrite newer data; changes are
  rate-limited and size-limited. After the account key is replaced, an app
  moves its copy to the new key and deletes the old one, so devices still
  using the old key stop syncing.
- Photos' **online library** (`"library": true`,
  [ADR 0016](docs/adr/0016-online-photo-library.md)) runs `/api/library/*`:
  each photo is sealed on the device (AES-256-GCM, each part with its own
  label) and kept in Cloudflare R2; one Durable Object per library keeps the
  list, with each photo's details sealed too. It only ever sees hashes of the
  library's id and token. The first token to reach a library is its only
  one; after the account key is replaced it moves to the new token, proven
  with the old one, which is refused from then on. If a device with the old
  key (a lost one) moves it first, it's theirs: Photos says so and starts a
  new library. Adding photos needs the
  storage code (20 wrong tries an hour from each internet address, so a
  stranger can't lock others out; the code is five or more random words),
  and changing the code locks
  every library. Hard limits across all libraries (1 TB, 10,000 uploads a
  day), plus 400,000 photos per library and 95 MB each, mean nobody can run
  up the bill.
- An app connects by sending the person to the hub with a one-time ECDH
  public key; after they confirm, the hub seals the app's key to it and sends
  it back in the URL fragment, only to that app's real address. The app and
  the hub never call each other's servers.
- Each app is its own origin (`<app>.shkriuss.app`), so browsers keep each
  app's saved data separate. Apps never get the account secret, only a key
  for themselves.
- User data stays in the browser (`localStorage`, and IndexedDB for photos).
  Nothing is sent anywhere unless the user turns on notifications while
  closed, or uses the account (sync, and Photos' online library).

**Browser protections (same headers on every site)**

- A strict Content Security Policy: only our own scripts, styles, images and
  connections; no inline code; no framing; Trusted Types required.
- HSTS (HTTPS only, with preload), `nosniff`, `Referrer-Policy: no-referrer`,
  a Permissions-Policy that turns off camera, microphone, location and more,
  and cross-origin isolation (COOP, CORP, COEP).
- No cookies, analytics, trackers, third-party scripts, fonts or CDNs. Browser
  tests fail if a page requests anything from another origin.

**Supply chain and repository**

- No secrets in the repository. The Cloudflare API token is stored only as a
  GitHub Actions secret, with just three permissions: _Workers Scripts: Edit_
  and _Workers R2 Storage: Edit_ (account), and _Workers Routes: Edit_ (the
  `shkriuss.app` zone only). It's a secret of two environments: `production`,
  which only `main` can use, and `preview`, which waits for the owner's
  approval, because a preview runs a pull request's code before it's
  merged. Photos' storage code is a secret of `production` only, handed to
  its Worker at deploy in a temporary file that's deleted straight after;
  previews never get it.
- gitleaks scans every commit for secrets; zizmor checks the workflows,
  including that each pinned commit really belongs to its action;
  `pnpm audit` checks for known vulnerabilities; Dependabot proposes updates
  (after a 7-day cooldown).
- GitHub Actions are pinned to exact commit SHAs, workflows start with no
  permissions, and code checkout doesn't keep credentials.
- pnpm only lets allow-listed packages run install scripts and won't pick
  versions published less than 7 days ago when it updates the lockfile. CI
  also refuses a pull request that adds a version that new to the lockfile
  by other means (`scripts/lockfile-age.ts`).
- Production deploys only happen from `main`, after every check passes,
  including the dependency audit, and only for `main`'s newest commit (so
  re-running an older run can't put older code back). Only the deploy steps
  see the token, and the deploy job installs without the shared package
  cache.

## Known limits

- The repository is public, so anyone can read the code and its history. It
  holds no secrets (gitleaks checks every commit); the only secrets are in
  GitHub Actions, which pull requests from other people's copies never get.
  Public repositories also get GitHub's own secret scanning, push protection,
  code scanning and rulesets; [docs/deployment.md](docs/deployment.md#github-settings)
  lists the settings to turn on.
- Cloudflare, as the host, sees visitors' IP addresses to deliver pages and
  answer the Workers. It always keeps traffic statistics (numbers of
  requests), and a short record (IP address, country, browser, page) of
  requests its firewall blocks as likely attacks. No extra Cloudflare
  analytics or logging is turned on: every Worker sets
  `"observability": { "enabled": false }`, and the owner doesn't use what's
  kept.
- Preview links (`*.workers.dev`) are public, and are posted in the pull
  request's comments, which are public too. Search engines are told not to
  index them. They run a pull request's code, never touch production's
  storage, and get no storage code. Every page of one says it's a preview,
  and not to use a real account or real data there.
