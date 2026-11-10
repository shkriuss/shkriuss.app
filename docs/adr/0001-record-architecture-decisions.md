# 0001 Record architecture decisions

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md), opening note and sections 3, 5, 12
  and 18

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

## Options rejected

- **Keep recording decisions in the plan after Phase 0.** Reason not
  recorded.

## Consequences

- Records 0001 to 0018 come from section 18 of the plan. They take the
  plan's content and add no new decisions.
- Where the plan gives no reason for a rejected option, the record says
  "Reason not recorded". The owner can add the reason later.
- A pull request that adds a runtime dependency or a permission, or changes
  a format, includes its record.
- Open: whether an accepted record may be edited later, or must be replaced
  by a new record. Some records are meant to be completed in later steps:
  0005, 0006, 0007, 0008, 0009, 0013, 0014 and 0017
  ([PROMPTS.md](../development/PROMPTS.md)). The template offers the status
  "Superseded by NNNN" for a record that a newer one replaces.
