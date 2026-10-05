# @shkriuss/data

The data layer: how every app stores its records, stamps its changes and merges copies of the same record. It implements the [data model spec](../../docs/specs/data-model.md) ([ADR 0004](../../docs/decisions/0004-local-data-and-backups.md)). Apps reach their data only through this package.

So far it has the parts that need no storage: pure functions on records, which the IndexedDB storage, the schemas and migrations, and the backup import build on.

| Module       | What it does                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hlc.ts`     | Hybrid logical clocks (§3): the format, issuing an HLC for a change, receiving HLCs from elsewhere, refusing clocks from the future; device ids          |
| `ids.ts`     | Record ids: UUIDv7 (RFC 9562), and the fixed id of the settings record                                                                                   |
| `json.ts`    | Field values (§2.3): checked, normalized copies of JSON values, and canonical JSON (RFC 8785) for comparing and measuring them                           |
| `names.ts`   | Field and store names (§2.3, §2.5)                                                                                                                       |
| `record.ts`  | The record format (§2): deleted or alive, the last change, the limits, and the structural checks for records from outside, such as a backup (§8, step 1) |
| `changes.ts` | Creating, updating and deleting a record within a change (§4)                                                                                            |
| `merge.ts`   | Merging two copies of a record (§5)                                                                                                                      |

Every function is pure: it returns a new record and never changes the one it is given. A refusal throws a `DataError` whose `code` says why: `invalid`, `too-large`, `future-clock` or `deleted`. Its message names fields, never their values, which are user data.

## Tests

- **Property-based tests** (fast-check, [ADR 0008](../../docs/decisions/0008-quality-gates.md)) check on generated records that merging is commutative, associative and idempotent, that it keeps the later write of every field, and that its result always passes the checks for records from outside. The generators draw clocks and field names from small sets, so copies often share fields and clocks, and sometimes have equal clocks with different values.
- **Examples** cover each situation of the data model's merge table, the RFC 8785 test vectors, and every check of section 8.
- **Coverage:** `pnpm --filter @shkriuss/data test` fails below 90% of lines, branches, functions or statements.
