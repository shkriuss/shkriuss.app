import { describe, expect, it } from 'vitest';
import { skipCiWords } from './skip-ci.ts';

describe('the words that stop GitHub’s runs (audit 7 H-5, run 32)', () => {
  it('finds each of them, in any case, once', () => {
    expect(skipCiWords('Docs: explain [skip ci]')).toEqual(['[skip ci]']);
    expect(
      skipCiWords('[CI Skip] one\n[no ci] two\n[skip actions] three\n[actions skip] [skip ci]'),
    ).toEqual(['[ci skip]', '[no ci]', '[skip actions]', '[actions skip]', '[skip ci]']);
    expect(skipCiWords('Fix\n\nskip-checks: true\n')).toEqual(['skip-checks: true']);
    expect(skipCiWords('Fix\n\nskip-checks:true')).toEqual(['skip-checks:true']);
    expect(skipCiWords('[skip ci] and [SKIP CI]')).toEqual(['[skip ci]']);
  });

  it('leaves other text alone', () => {
    expect(skipCiWords('')).toEqual([]);
    expect(skipCiWords('Skip CI for docs? No: every merge deploys.')).toEqual([]);
    expect(skipCiWords('skip ci, ci skip, [skip-ci], (skip ci)')).toEqual([]);
    expect(skipCiWords('This skips checks: true or not')).toEqual([]);
  });
});
