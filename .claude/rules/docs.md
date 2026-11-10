---
paths:
  - "docs/**"
---

# Rules for `docs/`

These add to CLAUDE.md. They never replace it.

- Write in plain English, short sentences. Number the steps.
- Write for a phone browser first. Never write an instruction that needs a
  computer, Android Studio, adb or a local build.
- Do not invent decisions. Where the plan or an ADR leaves something open,
  write "Open" and list it in the pull request.
- Record a new decision as an ADR in `docs/adr/`, not in
  `docs/plan/PLAN.md`. After Phase 0 the plan is kept as history.
- Each folder has a `README.md` index that says what belongs there. Keep it
  up to date when you add a page.
- Use relative links between pages, so they work on GitHub.
- Only the owner provides the values in `docs/security/fingerprints.md`.
- No secrets or tokens. No personal data, such as an email address, unless
  the owner provides it.
