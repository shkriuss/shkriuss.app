import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bucketsOf,
  siteBuckets,
  storageCodeSecret,
  withSecretsFile,
  workerSecrets,
} from './storage.ts';

describe('buckets', () => {
  const config = {
    r2_buckets: [{ bucket_name: 'shkriuss-photos' }],
    previews: { r2_buckets: [{ bucket_name: 'shkriuss-photos-preview' }] },
  };

  it('are the production or the preview ones', () => {
    expect(bucketsOf(config, 'production')).toEqual(['shkriuss-photos']);
    expect(bucketsOf(config, 'preview')).toEqual(['shkriuss-photos-preview']);
    expect(bucketsOf({}, 'preview')).toEqual([]);
  });

  it('are read from each site’s wrangler.jsonc', () => {
    expect(siteBuckets('photos', 'production')).toEqual(['shkriuss-photos']);
    expect(siteBuckets('photos', 'preview')).toEqual(['shkriuss-photos-preview']);
    expect(siteBuckets('tally', 'production')).toEqual([]);
  });
});

describe('secrets', () => {
  it('give a site with a library its storage code, from the GitHub secret', () => {
    expect(storageCodeSecret('photos')).toBe('PHOTOS_STORAGE_CODE');
    expect(storageCodeSecret('my-app')).toBe('MY_APP_STORAGE_CODE');
    const code = 'gravy tusk elbow mantle orbit';
    expect(workerSecrets('photos', true, { PHOTOS_STORAGE_CODE: code })).toEqual({
      secrets: { LIBRARY_STORAGE_CODE: code },
      missing: [],
      weak: [],
    });
    expect(workerSecrets('photos', true, {})).toEqual({
      secrets: {},
      missing: ['PHOTOS_STORAGE_CODE'],
      weak: [],
    });
    expect(workerSecrets('tally', false, { TALLY_STORAGE_CODE: 'x' })).toEqual({
      secrets: {},
      missing: [],
      weak: [],
    });
  });

  it('say when a storage code is too short to be safe, and still give it', () => {
    expect(workerSecrets('photos', true, { PHOTOS_STORAGE_CODE: 'photos2026' })).toEqual({
      secrets: { LIBRARY_STORAGE_CODE: 'photos2026' },
      missing: [],
      weak: ['PHOTOS_STORAGE_CODE'],
    });
  });

  it('go to wrangler in a private file that’s deleted afterwards', () => {
    let path = '';
    const result = withSecretsFile({ LIBRARY_STORAGE_CODE: 'five words' }, (args) => {
      expect(args[0]).toBe('--secrets-file');
      path = args[1] ?? '';
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
        LIBRARY_STORAGE_CODE: 'five words',
      });
      expect(statSync(path).mode & 0o077).toBe(0);
      return 'deployed';
    });
    expect(result).toBe('deployed');
    expect(existsSync(path)).toBe(false);
    expect(withSecretsFile({}, (args) => args)).toEqual([]);
  });
});
