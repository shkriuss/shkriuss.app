# Sync server

The server that the Sync app talks to: one Cloudflare Worker with a D1
database and an R2 bucket, in the user's own Cloudflare account. It
stores only ciphertext and is never trusted.

- What it does, byte by byte: [sync-protocol.md](../docs/architecture/sync-protocol.md).
- How it is checked, tested and deployed, and how to set up Cloudflare
  for it from a phone: [backend.md](../docs/development/backend.md).
- Licence: AGPL-3.0, in [LICENSE](LICENSE).
