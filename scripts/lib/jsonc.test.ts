import { describe, expect, it } from 'vitest';
import { parseJsonc } from './jsonc.ts';

describe('parseJsonc', () => {
  it('ignores comments and trailing commas', () => {
    const text = `// top comment
    {
      "a": 1, // line comment
      /* block
         comment */
      "b": [1, 2,],
    }`;
    expect(parseJsonc(text)).toEqual({ a: 1, b: [1, 2] });
  });

  it('keeps comment-like text inside strings', () => {
    expect(parseJsonc('{ "url": "https://example.com/*x*/", "q": "say \\"//hi\\"" }')).toEqual({
      url: 'https://example.com/*x*/',
      q: 'say "//hi"',
    });
  });
});
