import { normalizePassphrase } from "@shkriuss/backup";

/**
 * Whether the user typed the same passphrase twice (backup format §3.1): the same after the
 * normalization that encryption applies, so that one passphrase typed in two ways matches.
 */
export function samePassphrase(first: string, second: string): boolean {
  return normalizePassphrase(first) === normalizePassphrase(second);
}
