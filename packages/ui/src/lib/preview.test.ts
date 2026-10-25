import { describe, expect, it } from 'vitest';
import { isPreviewHost } from './preview.ts';

describe('isPreviewHost', () => {
  it('knows previews by their workers.dev address', () => {
    expect(isPreviewHost('pr-7-tally.shkriuss.workers.dev')).toBe(true);
    expect(isPreviewHost('pr-12-hub.shkriuss.workers.dev')).toBe(true);
    expect(isPreviewHost('PR-7-TALLY.SHKRIUSS.WORKERS.DEV')).toBe(true);
  });

  it('leaves the real sites and local test servers alone', () => {
    expect(isPreviewHost('shkriuss.app')).toBe(false);
    expect(isPreviewHost('tally.shkriuss.app')).toBe(false);
    expect(isPreviewHost('127.0.0.1')).toBe(false);
    expect(isPreviewHost('localhost')).toBe(false);
    // Only the end of the name counts.
    expect(isPreviewHost('workers.dev.example.com')).toBe(false);
    expect(isPreviewHost('notworkers.dev')).toBe(false);
  });
});
