/**
 * What apps with an online library (docs/adr/0016-online-photo-library.md)
 * need on Cloudflare besides their Worker: R2 buckets (scripts/buckets.ts
 * creates them) and the storage code, a secret given to the Worker at each
 * deploy (scripts/deploy.ts).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseJsonc } from './jsonc.ts';
import { repoRoot } from './sites.ts';

interface BucketConfig {
  r2_buckets?: { bucket_name: string }[];
}

/** The R2 buckets a Worker uses. */
export const bucketsOf = (config: BucketConfig): string[] =>
  (config.r2_buckets ?? []).map((bucket) => bucket.bucket_name);

/** The R2 buckets of the site in apps/<slug>. */
export function siteBuckets(slug: string, root: string = repoRoot): string[] {
  const config = parseJsonc(readFileSync(join(root, 'apps', slug, 'wrangler.jsonc'), 'utf8'));
  return bucketsOf(config as BucketConfig);
}

/** The GitHub secret with a site's storage code, e.g. PHOTOS_STORAGE_CODE. */
export const storageCodeSecret = (slug: string): string =>
  `${slug.toUpperCase().replaceAll('-', '_')}_STORAGE_CODE`;

/**
 * A storage code shorter than this is probably not five random words. The
 * code is what really stops guessing (ADR 0016), so the deploy warns.
 */
export const MIN_STORAGE_CODE_LENGTH = 24;

/**
 * The secrets a site's Worker gets when it's deployed (by their names in the
 * Worker), from the environment (GitHub Actions secrets), the GitHub secrets
 * that are missing, and those that look too short to be safe. Sites with an
 * online library get its storage code; others, nothing.
 */
export function workerSecrets(
  slug: string,
  library: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
): { secrets: Record<string, string>; missing: string[]; weak: string[] } {
  if (!library) return { secrets: {}, missing: [], weak: [] };
  const name = storageCodeSecret(slug);
  const code = env[name];
  if (!code) return { secrets: {}, missing: [name], weak: [] };
  const weak = code.trim().length < MIN_STORAGE_CODE_LENGTH ? [name] : [];
  return { secrets: { LIBRARY_STORAGE_CODE: code }, missing: [], weak };
}

/**
 * Runs `run` with wrangler's "--secrets-file" arguments: the secrets in a
 * temporary file only this user can read, deleted afterwards. With no
 * secrets, no arguments.
 */
export function withSecretsFile<T>(
  secrets: Readonly<Record<string, string>>,
  run: (args: string[]) => T,
): T {
  if (Object.keys(secrets).length === 0) return run([]);
  const folder = mkdtempSync(join(tmpdir(), 'worker-secrets-'));
  const file = join(folder, 'secrets.json');
  try {
    writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
    return run(['--secrets-file', file]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
