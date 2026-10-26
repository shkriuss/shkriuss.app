import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEW_DAY_CHECK_MS, onNewDay } from './new-day.ts';

/** A page that can go off screen and come back. */
class Page extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  show(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

let page: Page;
let changed: ReturnType<typeof vi.fn<(day: string, before: string) => void>>;

beforeEach(() => {
  // 23:59:30 on Monday 26 October 2026, in the time zone the tests run in.
  vi.useFakeTimers({ now: new Date(2026, 9, 26, 23, 59, 30) });
  vi.stubGlobal('window', { setInterval });
  page = new Page();
  changed = vi.fn<(day: string, before: string) => void>();
  onNewDay(changed, page as unknown as Document);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Each app had its own copy of this; now they share one (audit 4 J-11).
describe('onNewDay', () => {
  it('says so once at midnight, with the day before', () => {
    vi.advanceTimersByTime(NEW_DAY_CHECK_MS);
    expect(changed.mock.calls).toEqual([['2026-10-27', '2026-10-26']]);
    // Not again the same day.
    vi.advanceTimersByTime(10 * NEW_DAY_CHECK_MS);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('looks at once when the page comes back on screen', () => {
    // A phone's sleeping page runs its timers late, or not at all.
    vi.setSystemTime(new Date(2026, 9, 27, 8, 0));
    page.show('hidden');
    expect(changed).not.toHaveBeenCalled();
    page.show('visible');
    expect(changed.mock.calls).toEqual([['2026-10-27', '2026-10-26']]);
    // Its timer then finds nothing new.
    vi.advanceTimersByTime(NEW_DAY_CHECK_MS);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('says so once for a page asleep over two midnights, with the latest day', () => {
    vi.setSystemTime(new Date(2026, 9, 28, 9, 0));
    page.show('visible');
    expect(changed.mock.calls).toEqual([['2026-10-28', '2026-10-26']]);
    vi.advanceTimersByTime(NEW_DAY_CHECK_MS);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
