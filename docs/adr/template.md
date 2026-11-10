# Decision record template

Use this for every new decision record in this folder.

## How to use it

1. Pick the next free number. Numbers have four digits, for example `0020`.
2. Name the file `NNNN-short-title.md`, in lower case with hyphens.
3. Copy the block below. On GitHub, tap the copy button at its top right.
4. Fill in every section. Use plain English and short sentences.
5. Add the record to the list in [README.md](README.md).

Rules:

- One decision per record.
- Status is one of: `Proposed`, `Accepted`, or `Superseded by NNNN` with a
  link to the newer record.
- Date is the day the decision was agreed, written `YYYY-MM-DD`.
- Source says where the decision was agreed: a section of the
  [plan](../plan/PLAN.md), an issue or a pull request.
- Do not invent decisions or reasons. If no one wrote down why an option was
  rejected, write "Reason not recorded."
- Write "Open:" in front of anything not decided yet, and list it in the
  pull request.
- To edit or replace an accepted record, follow point 7 of
  [0001](0001-record-architecture-decisions.md).

## The template

```markdown
# NNNN Title of the decision

- Status: Proposed
- Date: YYYY-MM-DD
- Source: where it was agreed

## Context

The facts that led to the decision: the problem, the needs and the limits.
No decision here.

## Decision

What was decided, as short numbered points.

## Options rejected

- **Option.** Why it was rejected, or "Reason not recorded."

If no other option was considered, write "None recorded."

## Consequences

What follows from the decision: what it makes easier, what it makes harder,
what must be done, and which other records or docs it affects.
```
