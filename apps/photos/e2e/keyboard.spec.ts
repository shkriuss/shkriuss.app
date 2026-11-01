// Photos with a keyboard: where focus is, and that it can be seen, while
// choosing photos.
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { addPhotos, jpeg, picture } from './helpers.ts';

const tiles = (page: Page) => page.locator('[data-months] .tile');

/** How an element's outline is drawn: its style, width, colour and offset. */
const outline = (element: Locator) =>
  element.evaluate((node) => {
    const style = getComputedStyle(node);
    return `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor} ${style.outlineOffset}`;
  });

/** Adds `count` small photos (each a different colour: the same photo isn't added twice). */
async function addSome(page: Page, count: number): Promise<void> {
  const files = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      picture(page, { width: 120, height: 90, color: `hsl(${index * 11} 70% 50%)` }),
    ),
  );
  await addPhotos(
    page,
    files.map((buffer, index) => jpeg(`IMG_${String(index).padStart(4, '0')}.JPG`, buffer)),
  );
  await expect(tiles(page)).toHaveCount(count);
}

test('a chosen photo with keyboard focus shows the focus ring', async ({ page }) => {
  // (audit G-1)
  await page.goto('/');
  await addSome(page, 3);
  await page.getByRole('button', { name: 'Select' }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeFocused();

  // The ring a focused photo shows before it's chosen.
  await tiles(page).first().focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(tiles(page).first()).toBeFocused();
  const ring = await outline(tiles(page).first());

  // Chosen with Space, it keeps that ring; a chosen photo without focus looks different.
  await page.keyboard.press('Space');
  await expect(tiles(page).first()).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(tiles(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  expect(await outline(tiles(page).nth(1))).toBe(ring);
  expect(await outline(tiles(page).first())).not.toBe(ring);

  // In Windows contrast themes too: the focus ring is the theme's own focus colour.
  await page.emulateMedia({ forcedColors: 'active' });
  const done = page.getByRole('button', { name: 'Done' });
  await done.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(done).toBeFocused();
  const forcedRing = await outline(done);
  await tiles(page).nth(1).focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(tiles(page).nth(1)).toBeFocused();
  expect(await outline(tiles(page).nth(1))).toBe(forcedRing);
  expect(await outline(tiles(page).first())).not.toBe(forcedRing);
});

/** Where the selection bar and the element with focus are on the screen. */
const places = (page: Page) =>
  page.evaluate(() => {
    const box = (element: Element | null) => {
      const { top, bottom } = element?.getBoundingClientRect() ?? { top: 0, bottom: 0 };
      return { top: Math.round(top), bottom: Math.round(bottom) };
    };
    return {
      bar: box(document.querySelector('[data-selection]')),
      focused: box(document.activeElement),
      screen: innerHeight,
    };
  });

/** Presses a key `times` times. */
async function press(page: Page, key: string, times: number): Promise<void> {
  for (let count = 0; count < times; count += 1) await page.keyboard.press(key);
}

test('the selection bar stays in sight while choosing, never over the photo with focus', async ({
  page,
}) => {
  // It came before the photos but stuck to the bottom, so it scrolled away (audit G-12).
  await page.setViewportSize({ width: 360, height: 640 });
  // Scrolling to what gets focus happens at once, so where things are can be measured.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await addSome(page, 30);
  await page.getByRole('button', { name: 'Select' }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeFocused();

  // Tabbing through the photos, as with a keyboard, to one near the end, then back up.
  await press(page, 'Tab', 28);
  await expect(tiles(page).nth(27)).toBeFocused();
  const goingDown = await places(page);
  await press(page, 'Shift+Tab', 12);
  await expect(tiles(page).nth(15)).toBeFocused();
  const goingUp = await places(page);
  for (const { bar, focused, screen } of [goingDown, goingUp]) {
    expect(bar.top).toBeGreaterThanOrEqual(0);
    expect(bar.bottom).toBeLessThanOrEqual(screen);
    // The photo with focus is in sight (to the pixel), below the bar.
    expect(focused.top).toBeGreaterThanOrEqual(bar.bottom);
    expect(focused.bottom).toBeLessThanOrEqual(screen + 1);
  }

  // With large text the bar is tall: it scrolls with the page instead of covering the photos.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await expect(page.locator('[data-selection]')).toHaveClass(/selection--tall/);
  await page.keyboard.press('Shift+Tab');
  await expect(tiles(page).nth(14)).toBeFocused();
  const large = await places(page);
  expect(large.focused.top >= large.bar.bottom || large.focused.bottom <= large.bar.top).toBe(true);
});

test('the problem notice never covers the selection bar while choosing', async ({ page }) => {
  // Both stayed at the top of the screen, the notice over the bar: its
  // buttons couldn't be seen or tapped, even with keyboard focus (audit 6 G-2).
  await page.setViewportSize({ width: 360, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await addSome(page, 30);
  // The device is full: the next photo can't be saved, and the notice says so.
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('The device is full.', 'QuotaExceededError');
    };
  });
  await addPhotos(page, [jpeg('IMG_0100.JPG', await picture(page, { width: 120, height: 90 }))]);
  const notice = page.locator('[data-problem]');
  await expect(notice.getByRole('alert')).toContainText('1 photo couldn’t be saved.');

  // Choosing photos further down, to delete some.
  await page.getByRole('button', { name: 'Select' }).click();
  await press(page, 'Tab', 28);
  await expect(tiles(page).nth(27)).toBeFocused();
  await page.keyboard.press('Space');
  const bar = page.locator('[data-selection]');
  await expect(bar).toContainText('1 photo chosen');
  for (const name of ['Save originals', 'Delete', 'Done']) {
    const button = bar.getByRole('button', { name, exact: true });
    await button.focus();
    // What's at the middle of the button, and at its corners, is the button itself.
    const covered = await button.evaluate((element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect();
      const points = [
        [(left + right) / 2, (top + bottom) / 2],
        [left + 4, top + 4],
        [right - 4, top + 4],
        [left + 4, bottom - 4],
        [right - 4, bottom - 4],
      ] as const;
      return points.filter(([x, y]) => !element.contains(document.elementFromPoint(x, y))).length;
    });
    expect(covered, `${name}: points covered`).toBe(0);
    expect((await places(page)).focused.top).toBeGreaterThanOrEqual(0);
  }
  // The notice is still at the top of the page, and stays in sight again once choosing is done.
  await expect(notice.getByRole('alert')).toBeAttached();
  await bar.getByRole('button', { name: 'Done' }).click();
  expect(await notice.evaluate((element) => getComputedStyle(element).position)).toBe('sticky');
});
