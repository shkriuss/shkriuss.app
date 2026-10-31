import { describe, expect, it } from 'vitest';
import {
  loadProblemText,
  SAVE_PROBLEM_TEXTS,
  saveProblemText,
  spokenFieldProblem,
} from './problems.ts';

describe('loadProblemText (audit 5 E-3)', () => {
  it('says why what’s saved isn’t shown, that it isn’t lost, and what to do', () => {
    const newer = loadProblemText('newer');
    expect(newer).toMatch(/saved by a newer version of this app/);
    expect(newer).toMatch(/isn’t lost/);
    expect(newer).toMatch(/Restoring a backup now would replace it/);
    const unreadable = loadProblemText('unreadable');
    expect(unreadable).toMatch(/can’t be read by this version/);
    expect(unreadable).toMatch(/Reload the page/);
  });

  it('isn’t mistaken for a message about saving, which goes away once saving works', () => {
    for (const problem of ['newer', 'unreadable'] as const) {
      expect(SAVE_PROBLEM_TEXTS).not.toContain(loadProblemText(problem));
    }
  });
});

describe('saveProblemText', () => {
  it('says saving didn’t work, and why, in one way for every app', () => {
    expect(saveProblemText('unavailable')).toBe(
      'Couldn’t save. Is this browser in private mode, or is storage blocked?',
    );
    expect(saveProblemText('full')).toMatch(/^Couldn’t save: there’s no room left/);
    expect(saveProblemText('newer')).toMatch(/newer version/);
    expect(saveProblemText('unreadable')).toMatch(/can’t read/);
    expect(saveProblemText('invalid')).toMatch(/^Couldn’t save/);
  });

  it('knows every message it gives', () => {
    expect(SAVE_PROBLEM_TEXTS).toContain(saveProblemText('full'));
    expect(new Set(SAVE_PROBLEM_TEXTS).size).toBe(5);
    for (const text of SAVE_PROBLEM_TEXTS) expect(text).toMatch(/^Couldn’t save/);
  });
});

describe('spokenFieldProblem', () => {
  it('puts the field’s name first', () => {
    expect(spokenFieldProblem('Name', 'You already have a counter with that name.')).toBe(
      'Name: You already have a counter with that name.',
    );
  });

  it('tidies the label’s spaces and a colon at its end', () => {
    expect(spokenFieldProblem('\n   New counter\n  ', 'Enter a name.')).toBe(
      'New counter: Enter a name.',
    );
    expect(spokenFieldProblem('Amount:', 'Enter an amount.')).toBe('Amount: Enter an amount.');
  });

  it('gives only the error when the field has no name', () => {
    expect(spokenFieldProblem('', 'Enter a name.')).toBe('Enter a name.');
    expect(spokenFieldProblem(null, 'Enter a name.')).toBe('Enter a name.');
  });
});
