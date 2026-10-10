# @shkriuss/backup

Backups: the files that carry an app's data off a device and back, as the [backup format spec](../../docs/specs/backup-format.md) defines them ([ADR 0004](../../docs/decisions/0004-local-data-and-backups.md)). The records inside, their checks and their merge belong to [`@shkriuss/data`](../data); this package adds the file around them: the backup document, encryption with [age](https://age-encryption.org) in a worker, and passphrases.

| Module            | What it does                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backup-file.ts`  | Making a backup file of a database (§4), and reading one that the user offers (§5.2–§5.5)                                                                          |
| `document.ts`     | Writing the backup document of a snapshot (§2, §4), and reading one back with every check of §5.3–§5.5                                                             |
| `files.ts`        | Opening a file offered for import (§5.1), recognizing it by its content (§5.2), and the names and media types of backup files (§1)                                 |
| `crypto.ts`       | Encrypting and decrypting in the backup worker, from the page (§3.1)                                                                                               |
| `age.worker.ts`   | The backup worker, which answers one request and ends                                                                                                              |
| `age-messages.ts` | The messages between the page and the backup worker, and their checks                                                                                              |
| `age.ts`          | Encryption with age (§3), as the worker runs it                                                                                                                    |
| `passphrase.ts`   | Generated passphrases, their normalization, and the checks of a passphrase that the user picks (§3.1)                                                              |
| `words.ts`        | The 2,048 words of generated passphrases: the English word list of [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki), under the MIT License |
| `errors.ts`       | `BackupError`, whose `code` tells the conditions of §6 apart                                                                                                       |

## Export and import

```ts
import {
  createBackupFile,
  generatePassphrase,
  openBackupFile,
  readBackupFile,
} from "@shkriuss/backup";

// Export (§4): a consistent snapshot, encrypted in the backup worker. With `passphrase: null`,
// a plain backup, which the app offers only after the user confirms a warning.
const passphrase = generatePassphrase(); // or one the user typed twice, of 12 characters or more
const { file, fromFuture, counted } = await createBackupFile(db, { app: "notes", passphrase });
// file.name is "shkriuss-notes-2026-10-05.age". `fromFuture` is when its latest change is dated,
// if that is more than a day ahead of this device's clock (data model §3.5): the app says so.
// Once the app has handed the file over, with the changes that its snapshot had:
await db.recordBackup(counted);

// Import (§5): the size is checked before the file is read.
const opened = await openBackupFile(chosen);
// If opened.encrypted, the app asks for the passphrase; after `wrong-passphrase`, it asks again.
const { exported, incoming } = await readBackupFile(opened, passphrase, { app: "notes", schemas });
const preview = await db.previewImport(incoming); // shown with `exported`, before the user confirms
// Changes dated more than a day ahead (`preview.fromFuture`) import only once the user confirms.
await db.import(incoming, { acceptFromFuture: preview.fromFuture !== undefined });
```

`writeBackup()` and `readBackup()` do the same for the backup document alone, without a file or encryption.

The functions refuse with a `BackupError` (§6), and with a TypeError for a mistake in the app's code, such as a passphrase of fewer than 12 characters, or an encrypted file read without one:

| `code`             | When                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `too-large`        | the file is larger than 64 MiB, or a backup would be: every backup that is made must import                             |
| `not-a-backup`     | it is not UTF-8 JSON (a byte order mark included), or not an object whose `format` is `shkriuss-backup`                 |
| `wrong-passphrase` | the passphrase does not decrypt the file; the user can try again                                                        |
| `damaged`          | the age file is damaged or truncated, is not encrypted with a passphrase alone, or has a work factor above 18           |
| `no-memory`        | the device could not give the worker the memory that deriving the key takes; the user can try again, with less open     |
| `newer-version`    | its format version or schema version is newer than the app's; a newer format is refused before anything else is checked |
| `other-app`        | it is a backup of another app, whose id `error.app` gives                                                               |
| `invalid`          | any other member or record fails a check: the backup is damaged or was changed                                          |

Messages are for developers and contain no data from the backup, only ids. An unexpected failure in the worker is a plain `Error` whose message says only that the worker failed, and so is a worker that says nothing for 15 seconds, which the browser ended without a word.

## Encryption

- **age, version 1** (§3), through [`age-encryption`](https://github.com/FiloSottile/typage), by the author of age: one recipient stanza of type `scrypt`, work factor 18 (256 MiB), in the binary encoding. Importers also accept the ASCII-armored form, and refuse work factors above 18 before deriving any key: each step above doubles the memory, which a phone may not give a worker. The stanza must be as age writes it, with the work factor as a plain decimal number: `018`, `+18`, `1e1` or `0x12` are refused here, not left to the library.
- **Wrong passphrase or damaged file:** age authenticates the whole file before it gives any of it, so a damaged or truncated file never imports. A changed recipient stanza reads as a wrong passphrase, because age cannot tell the two apart.
- **Out of memory:** a device that cannot give the worker 256 MiB fails to derive the key with a `RangeError`, which is `no-memory`, never `damaged`: the backup is fine, and the user can try again with less open.
- **No lock-in:** the age command-line tool decrypts every encrypted backup, and backups that it encrypts with `age --passphrase` import. The tests read two files that it made.
- **In a worker** (§3.1): deriving the key takes seconds and 256 MiB on a phone. Each request starts a worker of its own through `@shkriuss/edge/workers` ([ADR 0011](../../docs/decisions/0011-worker-trusted-types-policy.md)), which ends after it, so that the worker holds the passphrase only during the operation. The page copies the bytes into the worker, so that the user can try another passphrase, and the worker moves the result back. A worker that has not said that its script has run after 15 seconds is given up and stopped: the browser ended it without an `error` event, as it may when memory runs short.
- **Only in the worker's bundle:** `age-encryption` and its libraries, [noble](https://paulmillr.com/noble/) and [scure](https://github.com/paulmillr/scure-base), are in the worker, and the page's JavaScript includes none of them. Their licenses ship in every app's `/licenses.txt`.

## Passphrases

- `generatePassphrase()` joins six words from `WORDS` with hyphens. Each word takes 11 bits from `crypto.getRandomValues`, so all 2,048 words are equally likely and a passphrase has 66 bits.
- `normalizePassphrase()` puts a passphrase in Unicode NFC, so the same passphrase typed on different devices gives the same bytes. It changes nothing else, and spaces count. Encryption and decryption normalize every passphrase.
- `isLongEnough()` checks that a passphrase the user picks has at least 12 characters, counted as people see them: an emoji or a letter with an accent counts once, and spaces, zero-width and other invisible characters do not count at all.
- `isEasyToGuess()` refuses a passphrase that the user picks when it is easy to guess, ignoring case, spaces and invisible characters: fewer than 5 different characters, a shorter part repeated, a run along the digits, the alphabet or the keyboard, or one of a few long passwords that people often use, such as `qwerty123456`.

## Tests

- **The spec's example:** the tests read the example document straight from the backup format spec, so the spec and the code cannot drift apart. The age command-line tool, version 1.1.1, encrypted it into `src/test/example.age` and, ASCII-armored, `src/test/example.armored.age`, with the passphrase in `src/test/fixtures.ts`; the tests decrypt both, at work factor 18. Like every backup fixture, they never change (§8).
- **Every refusal:** each check of §5.3–§5.5 has a test with the error code it gives, including invalid UTF-8 inside a string, a byte order mark, a day that does not exist, a clock after the year 9999, and members or stores named `__proto__` or `constructor`, which leave every object as it was. A clock from the future passes, and `createBackupFile()` says when a backup has one. A further test checks that a refused backup's data stays out of the error messages. Damaged age files are refused as `damaged`: truncated, without their last chunk, with a changed payload or header MAC, with a second stanza, one for a key, a work factor above 18 or not written as age writes one, or a header longer than 4096 bytes, the last four before any key is derived. A plain backup of exactly 64 MiB is made, and one of a byte more refused.
- **Stopping:** `createBackupFile()` and `readBackupFile()` take a `signal`. When it aborts, as when the user closes the dialog, the worker stops at once, so that two never derive keys together, and the call rejects with the signal's reason. A worker whose script has not run yet stops as soon as it has, which it says first: Firefox can crash the page when a worker stops while its script still compiles. A worker that says nothing for 15 seconds is stopped all the same, and its request fails.
- **The worker in Node.js:** the unit tests replace `@shkriuss/edge/workers` with `src/test/worker.ts`, which runs the worker's module on the test's thread and clones the messages as a browser does. They use a low work factor, which keeps them fast.
- **In browsers:** the [platform end-to-end tests](../../tooling/platform-e2e) make and read encrypted backups through the real worker, under the production headers, at work factor 18, and read the files that the age command-line tool made.
- **Properties** (fast-check, [ADR 0018](../../docs/decisions/0018-quality-gates-as-enforced.md)):
  - every snapshot of generated records reads back exactly as it was written;
  - any bytes, any JSON value, and the spec's example with any one part changed or removed are refused with a `BackupError`, or read into contents that write and read back the same;
  - a passphrase uses all 66 random bits and nothing else.
- **The word list** is checked against the SHA-256 of BIP-39's English list.
- **Coverage:** `pnpm --filter @shkriuss/backup test` fails below 90% of lines, branches, functions or statements.
