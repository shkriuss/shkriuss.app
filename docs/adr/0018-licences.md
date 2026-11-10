# 0018 Licences

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 2 (decision 10), 7 and 17

## Context

- The suite is open source and self-hostable (section 1).
- Each user deploys the sync backend to their own Cloudflare account from
  this repository (section 7).

## Decision

1. Apps: GPL-3.0.
2. Sync backend: AGPL-3.0.

## Options rejected

None recorded.

## Consequences

- The root [LICENSE](../../LICENSE) holds the GPL-3.0 text.
- The backend gets its own AGPL-3.0 licence file in `backend/` (step 5.2 in
  [PROMPTS.md](../development/PROMPTS.md)).
- Open: "GPL-3.0-only" or "GPL-3.0-or-later" (section 17).
- Open: the plan does not ask the same question for the backend. The
  choice is "AGPL-3.0-only" or "AGPL-3.0-or-later".
