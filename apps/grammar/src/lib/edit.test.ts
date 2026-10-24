import { describe, expect, it } from 'vitest';
import { editBetween, type Edit } from './edit.ts';

const made = (before: string, edit: Edit) =>
  before.slice(0, edit.start) + edit.text + before.slice(edit.end);

describe('editBetween', () => {
  it('replaces only what changes', () => {
    expect(editBetween('I has a apple.', 'I have a apple.')).toEqual({
      start: 4,
      end: 5,
      text: 've',
    });
  });

  it('adds and removes text', () => {
    expect(editBetween('a apple', 'an apple')).toEqual({ start: 1, end: 1, text: 'n' });
    expect(editBetween('the the cat', 'the cat')).toEqual({ start: 4, end: 8, text: '' });
    expect(editBetween('', 'Hello')).toEqual({ start: 0, end: 0, text: 'Hello' });
    expect(editBetween('Hello', '')).toEqual({ start: 0, end: 5, text: '' });
  });

  it('covers every change in one edit, from the first to the last', () => {
    const before = 'I has a apple. She go to school every days.';
    const after = 'I have an apple. She goes to school every day.';
    const edit = editBetween(before, after);
    expect(edit.start).toBe(4);
    expect(edit.end).toBe(before.length - 1);
    expect(made(before, edit)).toBe(after);
  });

  it('changes nothing when the text is the same', () => {
    expect(editBetween('Same.', 'Same.')).toEqual({ start: 5, end: 5, text: '' });
  });

  it('never splits an emoji (two UTF-16 units)', () => {
    // 😀 and 😁 start with the same unit; 😀 and 🈀 end with the same one.
    expect(editBetween('a😀b', 'a😁b')).toEqual({ start: 1, end: 3, text: '😁' });
    expect(editBetween('😀', '🈀')).toEqual({ start: 0, end: 2, text: '🈀' });
  });

  it('always makes the new text', () => {
    const pairs: [string, string][] = [
      ['aaa', 'aa'],
      ['aa', 'aaa'],
      ['abcabc', 'abc'],
      ['x😀y😀z', 'x😁y😁z'],
      ['Line one.\nLine two.', 'Line one.\n\nLine two!'],
    ];
    for (const [before, after] of pairs) {
      expect(made(before, editBetween(before, after))).toBe(after);
    }
  });
});
