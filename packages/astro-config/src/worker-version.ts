import { createHash } from 'node:crypto';

/**
 * The offline service worker's version: a hash of the files it saves, its
 * own code and the headers they're served with (`_headers`). Changing any of
 * them gives visitors a fresh saved copy; without the headers, a deploy that
 * only tightened the CSP left every saved copy with the old one
 * (audit 3 C-3).
 */
export function workerVersion(parts: { files: string; worker: string; headers: string }): string {
  return createHash('sha256')
    .update(parts.files)
    .update(parts.worker)
    .update(parts.headers)
    .digest('hex')
    .slice(0, 12);
}
