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

- Every site is static files on Cloudflare Workers static assets.
- The one exception is optional: apps that offer **notifications while
  closed** (Calendar) also run a small Worker for `/api/push/*`, with one
  Durable Object per device ([ADR 0009](docs/adr/0009-push-notifications.md)).
  It only ever holds messages encrypted on the user's device, delivery times
  and a time zone; each app has its own storage and signing key, generated
  by the server and never exported. Requests are size-limited, rate-limited
  and checked; push addresses must be https with a domain name.
- The hub also runs a small Worker for `/api/account/*`, for the optional
  **shkriuss account** ([ADR 0010](docs/adr/0010-account-and-sync.md)). It
  only holds values sealed on the device (AES-256-GCM): passkey locks, under
  the hash of a token only the passkey can produce, and one-time device links
  that expire after 10 minutes. It also notes account keys that were
  replaced (after a lost device), under the hash of a token only the old key
  can make; devices holding a replaced key sign out, and it can't sign in
  again. There are no account ids, emails or passwords. Requests from other
  sites are refused (`Sec-Fetch-Site`), and bodies are limited to 1 KB.
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
  with the old one, which is refused from then on. Adding photos needs the
  storage code (20 wrong tries an hour, in all), and changing the code locks
  every library. Hard limits across all libraries (1 TB, 20,000 uploads a
  day), plus 400,000 photos per library and 95 MB each, mean nobody can run
  up the bill.
- An app connects by sending the person to the hub with a one-time ECDH
  public key; after they confirm, the hub seals the app's key to it and sends
  it back in the URL fragment, only to that app's real address. The app and
  the hub never call each other's servers.
- Each app is its own origin (`<app>.shkriuss.app`), so browsers keep each
  app's saved data separate. Apps never get the account secret, only a key
  for themselves.
- User data stays in the browser (`localStorage`). Nothing is sent anywhere
  unless the user turns on notifications while closed, or uses the account.

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
- gitleaks scans every commit for secrets; zizmor checks the workflows;
  `pnpm audit` checks for known vulnerabilities; Dependabot proposes updates
  (after a 7-day cooldown).
- GitHub Actions are pinned to exact commit SHAs, workflows start with no
  permissions, and code checkout doesn't keep credentials.
- pnpm only lets allow-listed packages run install scripts and won't pick
  versions published less than 7 days ago when it updates the lockfile.
- Production deploys only happen from `main`, after every check passes,
  including the dependency audit. Only the deploy steps see the token.

## Known limits

- The repository is public, so anyone can read the code and its history. It
  holds no secrets (gitleaks checks every commit); the only secrets are in
  GitHub Actions, which pull requests from other people's copies never get.
  Public repositories also get GitHub's own secret scanning, push protection,
  code scanning and rulesets; [docs/deployment.md](docs/deployment.md#github-settings)
  lists the settings to turn on.
- Cloudflare, as the host, sees visitors' IP addresses to deliver pages. No
  Cloudflare analytics or logging is turned on for these sites.
- Preview links (`*.workers.dev`) are public, but not listed anywhere and not
  indexed by search engines. They contain the same code as production.
