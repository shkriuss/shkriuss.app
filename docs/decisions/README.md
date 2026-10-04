# Architecture decision records

An ADR is a short document that records one important decision: the context, what was decided, what it costs, and what else was considered.

- **Accepted ADRs are binding.** Code and docs follow them.
- **To change a decision,** add a new ADR that supersedes the old one, and mark the old one "Superseded by ADR NNNN". Don't rewrite history.
- **Numbering** is sequential and never reused.

| ADR                                      | Title                                  | Status   |
| ---------------------------------------- | -------------------------------------- | -------- |
| [0001](0001-domains-and-environments.md) | Domains and environments               | Accepted |
| [0002](0002-public-monorepo.md)          | One public monorepo under AGPL-3.0     | Accepted |
| [0003](0003-local-only-at-launch.md)     | Local-only apps at launch, no accounts | Accepted |
| [0004](0004-local-data-and-backups.md)   | Local data model and encrypted backups | Accepted |
| [0005](0005-frontend-stack.md)           | Frontend stack                         | Accepted |
| [0006](0006-hosting-and-deployment.md)   | Hosting and deployment on Cloudflare   | Accepted |
| [0007](0007-security-baseline.md)        | Security baseline                      | Accepted |
| [0008](0008-quality-gates.md)            | Quality gates and testing              | Accepted |

## Template

```markdown
# ADR NNNN: Title

- **Status:** Proposed | Accepted | Superseded by ADR NNNN
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
