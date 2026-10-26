import { describe, expect, it } from 'vitest';
import { headersFile } from './headers.ts';
import { workerVersion } from './worker-version.ts';

describe('the service worker version', () => {
  const parts = { files: 'abc123', worker: 'self.addEventListener…', headers: headersFile({}) };

  it('stays the same for the same build', () => {
    expect(workerVersion(parts)).toBe(workerVersion({ ...parts }));
    expect(workerVersion(parts)).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes when only the headers change (audit 3 C-3)', () => {
    const tighter = { ...parts, headers: headersFile({ allowFeatures: ['camera'] }) };
    expect(tighter.headers).not.toBe(parts.headers);
    expect(workerVersion(tighter)).not.toBe(workerVersion(parts));
  });

  it('changes when the files or the worker change', () => {
    expect(workerVersion({ ...parts, files: 'abc124' })).not.toBe(workerVersion(parts));
    expect(workerVersion({ ...parts, worker: 'other' })).not.toBe(workerVersion(parts));
  });
});
