# @shkriuss/backup

Backups: the files that carry an app's data off a device and back, as the [backup format spec](../../docs/specs/backup-format.md) defines them ([ADR 0004](../../docs/decisions/0004-local-data-and-backups.md)). The records inside, their checks and their merge belong to [`@shkriuss/data`](../data); this package adds the file around them.

So far it has the parts that need no encryption: the backup document, how files are recognized and named, and passphrases. Encryption with age, in a worker, comes next.

| Module          | What it does                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `document.ts`   | Writing the backup document of a snapshot (§2, §4), and reading one back with every check of §5.3–§5.5                                                             |
| `files.ts`      | Recognizing a file by its content (§5.2), and the names and media types of backup files (§1)                                                                       |
| `passphrase.ts` | Generated passphrases, their normalization and the minimum length of a passphrase the user picks (§3.1)                                                            |
| `words.ts`      | The 2,048 words of generated passphrases: the English word list of [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki), under the MIT License |
| `errors.ts`     | `BackupError`, whose `code` tells the conditions of §6 apart                                                                                                       |

## Export and import

```ts
import { backupFileName, readBackup, writeBackup } from "@shkriuss/backup";

// Export (§4): the document of a consistent snapshot. Refused above 64 MiB.
const made = new Date();
const bytes = writeBackup("notes", await db.snapshot(), made);
const name = backupFileName("notes", made, false); // "shkriuss-notes-2026-10-05.json"

// Import (§5): checks the document and its records, and migrates them.
const { exported, incoming } = readBackup(bytes, { app: "notes", schemas, now: Date.now() });
const preview = await db.previewImport(incoming); // shown with `exported`, before the user confirms
await db.import(incoming);
```

`readBackup()` refuses with a `BackupError` (§6):

| `code`          | When                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `too-large`     | the file is larger than 64 MiB                                                                                          |
| `not-a-backup`  | it is not UTF-8 JSON (a byte order mark included), or not an object whose `format` is `shkriuss-backup`                 |
| `newer-version` | its format version or schema version is newer than the app's; a newer format is refused before anything else is checked |
| `other-app`     | it is a backup of another app, whose id `error.app` gives                                                               |
| `future-clock`  | an HLC lies more than 24 hours ahead of this device's clock                                                             |
| `invalid`       | any other member or record fails a check: the backup is damaged or was changed                                          |

`wrong-passphrase` and `damaged` belong to decryption. Messages are for developers and contain no data from the backup, only ids.

## Passphrases

- `generatePassphrase()` joins six words from `WORDS` with hyphens. Each word takes 11 bits from `crypto.getRandomValues`, so all 2,048 words are equally likely and a passphrase has 66 bits.
- `normalizePassphrase()` puts a passphrase in Unicode NFC, so the same passphrase typed on different devices gives the same bytes. It changes nothing else, and spaces count.
- `isLongEnough()` checks that a passphrase the user picks has at least 12 characters, counted as people see them: an emoji or a letter with an accent counts once.

## Tests

- **The spec's example:** the tests read the example document straight from the backup format spec, so the spec and the code cannot drift apart.
- **Every refusal:** each check of §5.3–§5.5 has a test with the error code it gives, including invalid UTF-8 inside a string, a byte order mark, a day that does not exist and a record from the future. A further test checks that a refused backup's data stays out of the error messages.
- **Properties** (fast-check, [ADR 0008](../../docs/decisions/0008-quality-gates.md)):
  - every snapshot of generated records reads back exactly as it was written;
  - a passphrase uses all 66 random bits and nothing else.
- **The word list** is checked against the SHA-256 of BIP-39's English list.
- **Coverage:** `pnpm --filter @shkriuss/backup test` fails below 90% of lines, branches, functions or statements.
