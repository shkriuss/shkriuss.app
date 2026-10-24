import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_SIZE, SEARCH_DELAY_MS, shownCount, waitForTyping } from './long-lists.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('how many items a long list shows', () => {
  const ids = Array.from({ length: 250 }, (_, index) => `item-${index}`);

  it('is a page, or what "Show more" asked for', () => {
    expect(shownCount(ids, PAGE_SIZE)).toBe(100);
    expect(shownCount(ids, 2 * PAGE_SIZE)).toBe(200);
  });

  it('includes an item to keep in view, wherever it is', () => {
    expect(shownCount(ids, PAGE_SIZE, ['item-180'])).toBe(181);
    expect(shownCount(ids, PAGE_SIZE, ['item-3', null, 'item-120', undefined])).toBe(121);
    // One that isn't in the list (deleted, or in another view) changes nothing.
    expect(shownCount(ids, PAGE_SIZE, ['gone'])).toBe(100);
  });
});

describe('waiting for a pause in the typing', () => {
  it('runs once, after the last key press', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const typed = waitForTyping(run);
    typed();
    vi.advanceTimersByTime(SEARCH_DELAY_MS - 1);
    typed();
    vi.advanceTimersByTime(SEARCH_DELAY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledOnce();
  });

  it('runs straight away when flushed, and not again later', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const typed = waitForTyping(run);
    typed.flush();
    expect(run).not.toHaveBeenCalled();
    typed();
    typed.flush();
    expect(run).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(SEARCH_DELAY_MS);
    expect(run).toHaveBeenCalledOnce();
    typed();
    typed.cancel();
    vi.advanceTimersByTime(SEARCH_DELAY_MS);
    expect(run).toHaveBeenCalledOnce();
  });
});
