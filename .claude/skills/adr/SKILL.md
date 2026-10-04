---
name: adr
description: Record an architecture decision in docs/decisions/. Use when a change makes, changes or reverses a significant decision — a new kind of dependency, a data or backup format change, a security header change, a new service, or anything that contradicts an existing ADR.
---

# Record an architecture decision

1. Read `docs/decisions/README.md` (index and template) and every ADR the decision touches.
2. Take the next free number: highest existing number + 1, four digits. Numbers are never reused.
3. Write `docs/decisions/NNNN-short-kebab-title.md` from the template:
   - **Status:** `Accepted` only if the user agreed to the decision; otherwise `Proposed`.
   - **Date:** today, `YYYY-MM-DD`.
   - Context, Decision, Consequences, Alternatives considered. Keep it short and concrete; link the docs it affects.
4. If it replaces an earlier decision, set the old ADR's status to `Superseded by ADR NNNN` and leave its reasoning untouched.
5. Add a row to the index table in `docs/decisions/README.md`.
6. Update `docs/architecture.md`, `docs/threat-model.md` or `CLAUDE.md` wherever the decision changes what they say.
7. Run `pnpm format` and `pnpm check doc-links`, then mention the ADR in the pull request description.
