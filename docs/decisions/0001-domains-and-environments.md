# ADR 0001: Domains and environments

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

The apps are installable PWAs. Browser storage, installs and any future passkeys are bound to the exact origin or registrable domain, so the domain layout is effectively permanent once users exist. We own `shkriuss.app` and `shkriuss.dev`. Both are managed in the same Cloudflare account, and both top-level domains are HSTS-preloaded, so browsers only ever use HTTPS. Every change must be tested on real devices before users get it.

## Decision

- **Production:** the hub at `https://shkriuss.app`, and each app at `https://<id>.shkriuss.app`. `<id>` is the app's permanent id: descriptive, lowercase, for example `notes`.
- **Staging:** an exact mirror at `https://shkriuss.dev` and `https://<id>.shkriuss.dev`. It is private behind Cloudflare Access and sends `X-Robots-Tag: noindex`.
- **Local development:** `localhost`.
- **Permanent ids:** app ids and subdomains are never renamed, and are never reused after an app is retired.
- **Every subdomain of both domains is served only from this repository.**
- **Reserved ids:** `www`, `account`, `api`, `auth`, `id`, `admin`, `status`, `mail`, `static`.
- **`www.shkriuss.app` redirects to `shkriuss.app`.**

## Consequences

- An app's name must be chosen carefully in its spec. Renaming later would strand offline users' data.
- Staging can never share cookies, storage or passkeys with production, because it is a different registrable domain.
- Both zones must be configured identically (see the [setup checklist](../setup-checklist.md)).
- Anyone who guesses `shkriuss.dev` sees the Cloudflare Access login. The README and the hub point to `shkriuss.app`.

## Alternatives considered

- **`shkriuss.dev` for production with a separate staging domain** such as `shkriuss-staging.dev`: `.app` names the product better, `.dev` reads naturally as "development", and this needs one domain fewer.
- **Staging as a subdomain** (`staging.shkriuss.app`): it would share the registrable domain, and with it the cookie and passkey trust boundary. Rejected.
- **Generic app names** (`app-1`): meaningless, yet just as permanent. Rejected.
