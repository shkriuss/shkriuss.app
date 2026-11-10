---
paths:
  - ".github/workflows/**"
---

# Rules for `.github/workflows/`

These add to CLAUDE.md. They never replace it.

- Every file here is owner-only. Change one only when the owner asks for
  exactly that change. Never touch `release*.yml` otherwise.
- Pin every action to a full commit SHA, with the version in a comment.
- Only GitHub's own actions are allowed today. If you need another one, list
  it in the pull request with the reason and the SHA. Prefer a short shell
  step.
- Start every workflow with `permissions: contents: read`. Grant more only
  per job, with a comment that says why.
- Every job has a timeout and a concurrency group.
- Pass inputs through `env`. Never put an input or a file name straight
  into a shell line.
- No `pull_request_target`, except in `protected-paths`, which never checks
  out, builds or runs code from the pull request.
- There are no repository-level secrets. Use only the environment secrets
  named in section 13 of `docs/plan/PLAN.md`. Never print a secret.
- Emulator tests, signing and releases run only here, never in the cloud
  environment.
- Never disable or weaken a check to make a build pass.
