# 0001 Record architecture decisions

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md), opening note and sections 3, 5, 12
  and 18, and the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4)

## Context

- The owner and Claude agreed the plan on 2026-11-10.
- The plan is the source of truth only until Phase 0 turns each part into
  decision records and docs.
- Some changes are costly to reverse. The plan asks for a record before a
  new runtime dependency (section 3) and before a format change (section 5).
- Each Claude session starts fresh. Everything a session needs is in the
  repository, not in an old chat
  ([PROMPTS.md](../development/PROMPTS.md)).

## Decision

1. A decision that is costly to reverse gets a record in `docs/adr/`. One
   short file per decision.
2. Records are numbered from 0001 and follow [template.md](template.md).
3. Each record states its status, date, context, decision, options rejected
   and why, and consequences.
4. A record is needed before any of these:
   - a new runtime dependency (section 3, and hard rule 5 in
     [CLAUDE.md](../../CLAUDE.md)),
   - a new permission ("Definition of done" in CLAUDE.md),
   - a change to the backup format or the sync format (section 5, and
     "Changing formats" in CLAUDE.md).
5. New decisions go into a new record, not into the plan.
6. After Phase 0, the records and docs win over the plan. The plan is kept
   as history.
7. Editing records:
   - A record that [PROMPTS.md](../development/PROMPTS.md) says is
     completed in a later step may be extended in place until that phase
     ends. These are 0005, 0006, 0007, 0008, 0009, 0013, 0014 and 0017.
   - After that, a pull request may fix a record or add detail, as long as
     the decision stays the same.
   - A changed decision needs a new record. The old record is marked
     "Superseded by NNNN".

## Options rejected

- **Keep recording decisions in the plan after Phase 0.** One growing file
  hides when and why a decision changed. Separate dated records can be
  reviewed, linked and replaced one at a time.

## Consequences

- Records 0001 to 0018 come from section 18 of the plan. The owner added
  reasons and details in review.
- Record 0019 covers hard rule 1 in CLAUDE.md, which section 18 did not
  list.
- A pull request that adds a runtime dependency or a permission, or changes
  a format, includes its record.
