// Saved data in browser tests: putting it in place and reading it back, in
// the format createStore (@shkriuss/storage) uses: "shkriuss:<key>" holds
// {"v": version, "data": …}. Pass the app's own version constant (like
// ENTRIES_VERSION), so a test can't quietly keep writing an old format after
// the app moves on (audit J-16). A test of reading an old format writes that
// version on purpose.
import type { Page } from '@playwright/test';

export interface Saved {
  version: number;
  data: unknown;
}

/** Saves each store (by its key, without "shkriuss:"), then reloads the page to show them. */
export async function seedStores(
  page: Page,
  stores: Record<string, Saved>,
  { reload = true } = {},
): Promise<void> {
  await page.evaluate((entries) => {
    for (const [key, { version, data }] of Object.entries(entries)) {
      localStorage.setItem(`shkriuss:${key}`, JSON.stringify({ v: version, data }));
    }
  }, stores);
  if (reload) await page.reload();
}

/** What a store holds now, with its version, or null if nothing is saved. */
export const readStore = <T>(page: Page, key: string): Promise<{ v: number; data: T } | null> =>
  page.evaluate(
    (name) => JSON.parse(localStorage.getItem(`shkriuss:${name}`) ?? 'null') as never,
    key,
  );

/**
 * Fills this site's storage for real, as on a phone that's nearly full: with
 * a key no app reads, until only about `room` more characters fit. A change
 * that makes the data bigger then can't be saved, and one that makes it
 * smaller (in another tab, say) still can (audit 4 F3-1).
 */
export async function fillStorage(page: Page, room: number): Promise<void> {
  await page.evaluate((room) => {
    const fits = (length: number): boolean => {
      try {
        localStorage.setItem('e2e-filler', 'x'.repeat(length));
        return true;
      } catch {
        return false;
      }
    };
    let low = 0;
    let high = 20_000_000;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(middle)) low = middle;
      else high = middle - 1;
    }
    localStorage.setItem('e2e-filler', 'x'.repeat(Math.max(0, low - room)));
  }, room);
}
