// Deep check's download with the keyboard: when the panel with the focused
// button is replaced, focus moves to what takes its place, not back to the
// top of the page. The model's files never arrive here (the download is
// stopped), so this is quick; deep-check.spec.ts downloads the real model.
import { expect, test } from '../../../tests/e2e/fixtures.ts';

test('focus moves to “Stop the download”, and back to “Download Deep check”', async ({ page }) => {
  await page.route(
    (url) =>
      url.pathname.startsWith('/on-demand/deep-check/') && !url.pathname.endsWith('/manifest.json'),
    () => {
      // The model's files take their time.
    },
  );
  await page.goto('/');
  const deep = page.locator('[data-deep]');
  const download = deep.getByRole('button', { name: 'Download Deep check' });
  const stop = deep.getByRole('button', { name: 'Stop the download' });

  await download.focus();
  await page.keyboard.press('Enter');
  await expect(stop).toBeFocused();
  await expect(download).toBeHidden();

  await page.keyboard.press('Enter');
  await expect(deep.locator('[data-deep-problem]')).toHaveText(/^Download stopped\./);
  await expect(download).toBeFocused();
});
