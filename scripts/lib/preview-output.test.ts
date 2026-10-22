import { describe, expect, it } from 'vitest';
import { closedPreviews, previewComment, previewUrlFromJson } from './preview-output.ts';

describe('previewUrlFromJson', () => {
  it('reads the preview URL, ignoring log lines around the JSON', () => {
    const stdout = `▲ [WARNING] Proxy environment variables detected.
{
  "preview": { "name": "pr-3", "urls": ["https://pr-3-tally.shkriuss.workers.dev"] },
  "deployment": { "id": "abc", "urls": ["https://abc-tally.shkriuss.workers.dev"] }
}`;
    expect(previewUrlFromJson(stdout)).toBe('https://pr-3-tally.shkriuss.workers.dev');
  });

  it('falls back to the deployment URL', () => {
    const stdout = JSON.stringify({
      preview: { urls: [] },
      deployment: { urls: ['https://x.dev'] },
    });
    expect(previewUrlFromJson(stdout)).toBe('https://x.dev');
  });

  it('returns undefined when there is no usable URL', () => {
    expect(previewUrlFromJson('')).toBeUndefined();
    expect(previewUrlFromJson('{ not json }')).toBeUndefined();
    expect(previewUrlFromJson('{"preview":{"urls":["javascript:alert(1)"]}}')).toBeUndefined();
  });
});

describe('previewComment', () => {
  it('lists every site and flags failures', () => {
    const comment = previewComment(
      [
        { slug: 'hub', url: 'https://pr-3-hub.shkriuss.workers.dev' },
        { slug: 'tally', url: undefined },
      ],
      '0123456789abcdef',
    );
    expect(comment).toContain('| hub | https://pr-3-hub.shkriuss.workers.dev |');
    expect(comment).toContain('| tally | ❌ failed');
    expect(comment).toContain('commit 0123456');
  });
});

describe('closedPreviews', () => {
  it('finds previews of pull requests that are no longer open, and nothing else', () => {
    expect(closedPreviews(['pr-3', 'pr-12', 'pr-50', 'main', 'pr-x'], [12, 51])).toEqual([
      'pr-3',
      'pr-50',
    ]);
    expect(closedPreviews([], [1])).toEqual([]);
  });
});
