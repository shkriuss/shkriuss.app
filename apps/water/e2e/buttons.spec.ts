// Water's two main buttons ("Glass 250 ml", "Bottle 500 ml") on phones of
// every size, and with large text.
import type { Page } from '@playwright/test';
import { expect, test } from '../../../tests/e2e/fixtures.ts';

/** Words in the two main buttons that are drawn on two lines (broken in the middle). */
const brokenWords = (page: Page) =>
  page.evaluate(() => {
    const broken: string[] = [];
    for (const button of document.querySelectorAll('[data-add]')) {
      const texts = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      for (let node = texts.nextNode(); node; node = texts.nextNode()) {
        for (const word of (node.textContent ?? '').matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, word.index);
          range.setEnd(node, word.index + word[0].length);
          const lines = new Set(
            [...range.getClientRects()]
              .filter((box) => box.width > 0)
              .map((box) => Math.round(box.top)),
          );
          if (lines.size > 1) broken.push(word[0]);
        }
      }
    }
    return broken;
  });

test('the two main buttons never break a word in two', async ({ page }) => {
  // On ordinary phones they read "Gla / ss 250 / ml" (audit G-10).
  await page.goto('/');
  for (const [width, text] of [
    [412, '100%'],
    [390, '100%'],
    [360, '100%'],
    [320, '100%'],
    [768, '100%'],
    [360, '200%'],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size;
    }, text);
    await expect(page.getByRole('button', { name: /^Glass/ })).toBeVisible();
    expect(await brokenWords(page), `${width}px, text ${text}`).toEqual([]);
  }
});
