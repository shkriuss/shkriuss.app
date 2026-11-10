---
paths:
  - "backend/**"
---

# Rules for `backend/`

These add to CLAUDE.md. They never replace it.

- The backend is one Cloudflare Worker. D1 holds encrypted records with
  server-assigned sequence numbers. R2 holds encrypted file chunks. No
  Durable Objects, no CRDT libraries.
- The server stores only ciphertext and is never trusted. It never needs a
  key that can decrypt user data.
- Follow `docs/architecture/sync-protocol.md` exactly. If it is wrong or
  silent, stop and ask.
- A sync format change bumps the format version, keeps readers for every
  older version, adds an ADR and updates `docs/architecture/`.
- Design for the Cloudflare free plan: 10 ms CPU per request, 100,000
  requests a day, 100,000 D1 row writes a day.
- Each user deploys the backend to their own Cloudflare account from this
  repository, using only a phone browser.
- Dependencies are pinned and locked with a lockfile. A new dependency needs
  an ADR.
- Tests run locally.
- The backend is licensed AGPL-3.0.
- Claude has no Cloudflare access. `CLOUDFLARE_API_TOKEN` lives only in the
  `cloudflare` GitHub environment. Never ask for it in a session.
- Never log user content.
