# Threat model

- **Status:** accepted
- **Last updated:** 2026-10-05
- **Last reviewed:** 2026-10-04, at the end of Phase 0
- **Applies to:** the local-only platform (no accounts, no sync, no backend). Revisit before adding any feature that uses the network.

## 1. What we protect

| #   | Asset                                 | Why it matters                                                            |
| --- | ------------------------------------- | ------------------------------------------------------------------------- |
| A1  | User data inside each app             | Personal notes, lists, health records and similar                         |
| A2  | Backup files                          | Copies of A1 that leave the device (cloud drives, email)                  |
| A3  | Backup passphrases                    | They unlock A2                                                            |
| A4  | Integrity of the delivered code       | Code running in an app's origin can read all of that app's data           |
| A5  | Developer accounts and infrastructure | GitHub, Cloudflare and the domain registrar decide what code is delivered |
| A6  | Users' privacy                        | Which apps someone uses, and when                                         |

## 2. Actors

| Actor                                                | Trust                                   | Notes                                                        |
| ---------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------ |
| Other websites, and other shkriuss apps              | untrusted                               | Isolated by the browser's same-origin policy                 |
| Anyone who sends a crafted link or backup file       | untrusted                               | Imports are hostile input                                    |
| Network attacker (for example, public Wi-Fi)         | untrusted                               | HTTPS only; the `.app` and `.dev` domains are HSTS-preloaded |
| Malicious or compromised dependency or GitHub Action | untrusted                               | Supply-chain controls                                        |
| Attacker targeting the developer's accounts          | untrusted                               | Strong account security                                      |
| Cloud storage holding backups (Drive, iCloud)        | untrusted with content                  | Backups are encrypted by default                             |
| Cloudflare (hosting)                                 | trusted to deliver our files unmodified | Sees request metadata; see R1 and R5                         |
| The user's own device, operating system and browser  | trusted                                 | A compromised device is out of scope                         |

## 3. Trust boundaries

1. **Origin** — each app (`<id>.shkriuss.app`) is isolated from every other origin, including the hub and the other apps.
2. **Code delivery** — dependencies → this repository → GitHub Actions → Cloudflare → the browser and its service worker cache.
3. **Device** — data crosses it only as a file the user exports.

## 4. Threats and mitigations

| #   | Threat                                                        | Mitigations                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Script injection (XSS) reads or changes data                  | No HTML injection sinks or `eval` (lint-enforced where possible); user content rendered as text; strict CSP with `require-trusted-types-for 'script'` and no Trusted Types policy except one that accepts only the app's own worker scripts; `Integrity-Policy`; end-to-end tests fail on any CSP violation |
| T2  | Malicious dependency                                          | Few dependencies, each justified; pnpm release-age delay, trust policy, blocked install scripts, frozen lockfile; Dependabot alerts; CodeQL; no third-party code at runtime                                                                                                                                 |
| T3  | Compromised CI or GitHub Action                               | Actions pinned to commit SHAs; read-only default token; workflows audited with zizmor; deploy credentials only in protected environments; production requires manual approval; the job that signs build provenance runs no code from the repository or its dependencies                                     |
| T4  | Developer account takeover                                    | Passkey or security-key two-factor authentication on GitHub, Cloudflare and the email account behind them; least-privilege API tokens; protected `main` branch; audit logs                                                                                                                                  |
| T5  | Tampered code served to users                                 | HTTPS with HSTS preload; integrity hashes on every script the page loads, which `Integrity-Policy` enforces (worker scripts excepted, see R6); public source, build provenance and published file hashes make tampering detectable (see R1)                                                                 |
| T6  | Crafted backup file                                           | Size limits; strict parsing and schema validation; clock values more than 24 hours in the future refused, so a file cannot make its changes win forever; imported data is never executed or rendered as HTML; preview before applying; all-or-nothing transaction                                           |
| T7  | Backup file read by whoever holds it                          | `age` encryption with a passphrase (scrypt) by default; generated passphrases offered; plain export only after a warning                                                                                                                                                                                    |
| T8  | Data loss: eviction, uninstall, lost device, bad update       | Persistent-storage request; backup reminders; transactional, tested migrations; staging and real-device checks before production; production gets only the exact build that staging got, and never a changed file under a name browsers have cached; service-worker kill switch                             |
| T9  | Clickjacking and framing                                      | `frame-ancestors 'none'` and `X-Frame-Options: DENY`                                                                                                                                                                                                                                                        |
| T10 | Cross-origin leaks (Spectre-style attacks, window references) | COOP `same-origin`, COEP `require-corp`, CORP `same-origin`                                                                                                                                                                                                                                                 |
| T11 | Tracking and metadata leaks                                   | No third-party requests, cookies or analytics; Cloudflare's Network Error Logging off, so browsers send no error reports; `Referrer-Policy: no-referrer`; minimal logs                                                                                                                                      |
| T12 | Rogue or taken-over subdomain                                 | Every subdomain deployed from this repository; no third-party hosting; no wildcard or dangling DNS records; DNSSEC; CAA records                                                                                                                                                                             |
| T13 | Phishing email that appears to come from our domains          | Null MX, SPF `-all` and DMARC `p=reject` on both domains                                                                                                                                                                                                                                                    |
| T14 | Misused browser capabilities                                  | `Permissions-Policy` denies every feature an app does not explicitly need                                                                                                                                                                                                                                   |

## 5. Residual risks (accepted)

- **R1 — Web code delivery.** As with every web app, users trust the code served when the app loads. Someone who controls the deploy pipeline or the host could ship code that reads app data. Account security and transparency (public source, provenance, file hashes) make this harder and detectable, but cannot eliminate it. Browser-enforced transparency (WAICT) will be adopted when browsers support it.
- **R2 — Compromised device, browser or extension** can read app data. Out of scope; an optional app lock may be added later.
- **R3 — Lost passphrase** means an encrypted backup cannot be opened. This is by design.
- **R4 — Storage loss outside our control.** The user or the operating system can clear site data, and removing an installed iOS app deletes its data. Only backups protect against this.
- **R5 — Metadata seen by Cloudflare:** IP address, user agent and which files are requested.
- **R6 — Worker scripts without integrity checks.** Browsers cannot check the integrity of worker and service worker scripts ([ADR 0011](decisions/0011-worker-trusted-types-policy.md)). Only the app's own files can become worker scripts, and the published file hashes and build provenance cover them, but a changed worker script would run. A changed `/sw.js` would control the app's pages until it is replaced; it is trusted as much as `index.html`, which has no hash either.

## 6. Review

Revisit this document:

- before each phase is completed;
- whenever a change sends anything over the network, adds a browser permission or adds a runtime dependency;
- before any work on accounts or sync starts.
