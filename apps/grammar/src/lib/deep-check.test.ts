import { describe, expect, it } from 'vitest';
import {
  DEEP_CHECK_PATH,
  downloadBytes,
  hashedName,
  isManifest,
  manifestFiles,
  megabytes,
  parts,
  type DeepCheckManifest,
} from './deep-check.ts';

const file = (name: string, bytes = 10) => ({
  path: `${DEEP_CHECK_PATH}${name}`,
  bytes,
  sha256: 'a'.repeat(64),
});
const manifest: DeepCheckManifest = {
  version: 1,
  runtime: file('ort.mjs'),
  loader: file('loader.mjs'),
  wasm: file('ort.wasm'),
  vocab: file('vocab.json'),
  merges: file('merges.txt'),
  labels: file('labels.txt'),
  verbs: file('verbs.txt'),
  model: [file('model-01.bin', 100), file('model-02.bin', 50)],
};

describe('the manifest', () => {
  it('lists every file and their total size', () => {
    expect(manifestFiles(manifest)).toHaveLength(9);
    expect(downloadBytes(manifest)).toBe(220);
  });

  it('accepts only files in the Deep check folder, with sizes and checksums', () => {
    expect(isManifest(manifest)).toBe(true);
    expect(isManifest(JSON.parse(JSON.stringify(manifest)))).toBe(true);
    expect(isManifest({ ...manifest, version: 2 })).toBe(false);
    expect(isManifest({ ...manifest, model: [] })).toBe(false);
    expect(isManifest({ ...manifest, wasm: { ...manifest.wasm, path: '/other/ort.wasm' } })).toBe(
      false,
    );
    expect(isManifest({ ...manifest, vocab: file('../../sw.js') })).toBe(false);
    expect(isManifest({ ...manifest, labels: { ...manifest.labels, sha256: 'nope' } })).toBe(false);
    expect(isManifest({ ...manifest, verbs: { ...manifest.verbs, bytes: 0 } })).toBe(false);
    expect(isManifest(null)).toBe(false);
  });
});

describe('file names and parts', () => {
  it('names files after their content', () => {
    expect(hashedName('labels.txt', '5afe93088eb6d80372cb57ac')).toBe('labels.5afe93088eb6.txt');
    expect(hashedName('ort.wasm.min.mjs', '219e6a1fc8a99382')).toBe(
      'ort.wasm.min.219e6a1fc8a9.mjs',
    );
    expect(hashedName('LICENSE', '0123456789abcdef')).toBe('LICENSE.0123456789ab');
  });

  it('splits a big file into parts', () => {
    expect(parts(25, 10)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 20 },
      { start: 20, end: 25 },
    ]);
    expect(parts(20, 10)).toHaveLength(2);
  });

  it('shows sizes like phones do', () => {
    expect(megabytes(381_399_413)).toBe('381 MB');
  });
});
