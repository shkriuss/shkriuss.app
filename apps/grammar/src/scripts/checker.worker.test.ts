/**
 * The checker worker with the real Harper (harper.js runs in Node too).
 * Each message arrives as its own task, as in a browser's worker.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { FromChecker, ToChecker } from '../lib/grammar.ts';

const sent: FromChecker[] = [];
let listener: ((event: { data: ToChecker }) => void) | undefined;

/** Sends the worker a message, in a task of its own. */
const tell = (message: ToChecker): void => {
  setTimeout(() => listener?.({ data: message }), 0);
};
const answer = (type: FromChecker['type']) =>
  vi.waitFor(
    () => {
      const found = sent.find((message) => message.type === type);
      if (!found) throw new Error(`No ${type} yet`);
      return found;
    },
    { timeout: 20_000, interval: 20 },
  );

beforeAll(async () => {
  vi.stubGlobal('addEventListener', (type: string, handler: typeof listener) => {
    if (type === 'message') listener = handler;
  });
  vi.stubGlobal('postMessage', (message: FromChecker) => sent.push(message));
  await import('./checker.worker.ts');
});

describe('the checker', () => {
  it('takes a new English and dictionary that arrive while it starts', async () => {
    tell({ type: 'start', english: 'american', words: ['Shkriuss'] });
    // Another device chose British English while Harper was loading:
    // settingsChanged() sends the English, then the words. Handled at the
    // same time, they made the checker fail (audit F3-4).
    tell({ type: 'english', english: 'british' });
    tell({ type: 'words', words: ['Shkriuss'] });
    await answer('ready');
    tell({ type: 'check', id: 1, text: 'I has a apple. Shkriuss likes the colour.' });
    const checked = await answer('checked');

    expect(sent.map((message) => message.type)).toEqual(['ready', 'checked']);
    const problems = checked.type === 'checked' ? checked.issues.map((issue) => issue.problem) : [];
    expect(problems).toContain('has');
    // British: "colour" is right. In the dictionary: "Shkriuss" is right.
    expect(problems).not.toContain('colour');
    expect(problems).not.toContain('Shkriuss');
  }, 30_000);
});
