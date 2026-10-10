# Architecture decision records

An ADR is a short document that records one important decision: the context, what was decided, what it costs, and what else was considered.

- **Accepted ADRs are binding.** Code and docs follow them.
- **To change a decision,** add a new ADR that supersedes the old one, and mark the old one "Superseded by ADR NNNN". Don't rewrite history.
- **To change part of a decision,** the new ADR says what changes, and the old one keeps its text, with a pointer at the point that changed: its status becomes "Accepted, amended by ADR NNNN" where its decision stands with a point changed, or "Partly superseded by ADR NNNN" where a point no longer holds. The index repeats each ADR's status as the ADR states it.
- **Numbering** is sequential and never reused.

| ADR                                         | Title                                           | Status                                                                                                   |
| ------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [0001](0001-domains-and-environments.md)    | Domains and environments                        | Accepted                                                                                                 |
| [0002](0002-public-monorepo.md)             | One public monorepo under AGPL-3.0              | Accepted, amended by ADR 0018                                                                            |
| [0003](0003-local-only-at-launch.md)        | Local-only apps at launch, no accounts          | Accepted                                                                                                 |
| [0004](0004-local-data-and-backups.md)      | Local data model and encrypted backups          | Accepted                                                                                                 |
| [0005](0005-frontend-stack.md)              | Frontend stack                                  | Superseded by ADR 0016; earlier, the row on translations by ADR 0012, and the row on routing by ADR 0013 |
| [0006](0006-hosting-and-deployment.md)      | Hosting and deployment on Cloudflare            | Superseded by ADR 0017                                                                                   |
| [0007](0007-security-baseline.md)           | Security baseline                               | Accepted, amended by ADR 0010, ADR 0011, ADR 0014                                                        |
| [0008](0008-quality-gates.md)               | Quality gates and testing                       | Superseded by ADR 0018                                                                                   |
| [0009](0009-stay-on-pnpm-11.md)             | Stay on pnpm 11 for now                         | Accepted                                                                                                 |
| [0010](0010-script-integrity.md)            | Script integrity with a hash-allowed import map | Accepted                                                                                                 |
| [0011](0011-worker-trusted-types-policy.md) | One Trusted Types policy for worker scripts     | Accepted                                                                                                 |
| [0012](0012-typed-messages.md)              | Typed message modules instead of Paraglide JS   | Accepted                                                                                                 |
| [0013](0013-routes-in-code.md)              | Routes declared in code                         | Accepted                                                                                                 |
| [0014](0014-webassembly.md)                 | WebAssembly for apps that declare it            | Partly superseded by ADR 0019: the last item of point 3, on when the service worker keeps modules        |
| [0015](0015-releasing-apps.md)              | Release each app to production on its own       | Accepted                                                                                                 |
| [0016](0016-frontend-stack-as-built.md)     | The frontend stack as built                     | Accepted                                                                                                 |
| [0017](0017-deploy-and-fix-forward.md)      | Deploy every app, and fix forward               | Accepted                                                                                                 |
| [0018](0018-quality-gates-as-enforced.md)   | Quality gates as CI enforces them               | Accepted                                                                                                 |
| [0019](0019-files-kept-on-first-use.md)     | Large files kept on first use                   | Accepted                                                                                                 |
| [0020](0020-deployment-accounts.md)         | One Cloudflare account per environment          | Proposed                                                                                                 |
| [0021](0021-pnpm-after-corepack.md)         | pnpm after Corepack                             | Proposed                                                                                                 |

## Template

```markdown
# ADR NNNN: Title

- **Status:** Proposed | Accepted | Accepted, amended by ADR NNNN | Partly superseded by ADR NNNN | Superseded by ADR NNNN
- **Date:** YYYY-MM-DD

## Context

What problem or force makes a decision necessary?

## Decision

What we will do.

## Consequences

What becomes easier, what becomes harder, and what we must now keep doing.

## Alternatives considered

The other options and why they lost.
```
