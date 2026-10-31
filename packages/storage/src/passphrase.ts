/**
 * The passphrase a backup is locked with (./backup.ts): the rule it must
 * meet, on its own so the "Back up" form can check it as it's typed without
 * loading the backup code, which a page loads only when a file is locked,
 * read or restored (the pages' JavaScript budget, audit 5).
 */

/** Shorter passphrases are refused. */
export const MIN_PASSPHRASE_LENGTH = 12;

/** A reason the passphrase can't be used, or undefined if it's fine. */
export function passphraseProblem(passphrase: string): string | undefined {
  if ([...passphrase.normalize('NFC')].length < MIN_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  }
  return undefined;
}
