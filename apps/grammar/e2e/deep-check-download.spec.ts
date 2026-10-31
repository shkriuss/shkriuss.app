// Deep check's download, with small stand-in files instead of the model (so
// this is quick; deep-check.spec.ts downloads the real one): a second tap on
// "Download Deep check" while the list of files comes doesn't download
// everything twice, and "Stop the download" stops it (audit F3-5). The list
// takes 300 ms, like a phone network. While it comes, the page says so, and
// it says when the list doesn't come (audit 3 G-7).
import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from '../../../tests/e2e/fixtures.ts';

const DIR = '/on-demand/deep-check/';
const names = ['runtime', 'loader', 'wasm', 'vocab', 'merges', 'labels', 'verbs'] as const;
const body = (name: string) => Buffer.from(`stand-in for ${name}\n`.repeat(50));
const file = (name: string) => ({
  path: `${DIR}${name}.test.bin`,
  bytes: body(name).length,
  sha256: createHash('sha256').update(body(name)).digest('hex'),
});
const manifest = {
  version: 1,
  ...Object.fromEntries(names.map((name) => [name, file(name)])),
  model: [file('model-1'), file('model-2')],
};

/**
 * Serves the stand-in files, each after `delay` ms (the list of files after
 * 300 ms, and not before `listed`); returns how often each was asked for.
 */
async function standIns(
  page: Page,
  delay: number,
  listed: Promise<void> = Promise.resolve(),
): Promise<Map<string, number>> {
  const fetched = new Map<string, number>();
  await page.route(`**${DIR}**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `${DIR}manifest.json`) {
      await Promise.all([new Promise((resolve) => setTimeout(resolve, 300)), listed]);
      await route.fulfill({ json: manifest });
      return;
    }
    fetched.set(path, (fetched.get(path) ?? 0) + 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
    const name = path.slice(DIR.length).replace('.test.bin', '');
    await route
      .fulfill({ body: body(name), contentType: 'application/octet-stream' })
      .catch(() => undefined);
  });
  return fetched;
}

const deep = (page: Page) => page.locator('[data-deep]');
const downloadButton = (page: Page) =>
  deep(page).getByRole('button', { name: 'Download Deep check' });

test('a double tap on “Download Deep check” downloads each file once', async ({ page }) => {
  // The list comes once the second tap is made: on a busy machine, the
  // checks below could take longer than the list's 300 ms.
  let list = (): void => undefined;
  const listed = new Promise<void>((resolve) => {
    list = resolve;
  });
  const fetched = await standIns(page, 200, listed);
  await page.goto('/');
  await expect(downloadButton(page)).toBeVisible();
  await downloadButton(page).click();
  // Busy while the list of files comes: it keeps focus, and another tap does nothing.
  await expect(downloadButton(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(downloadButton(page)).toBeFocused();
  await downloadButton(page).dispatchEvent('click');
  list();
  await expect(deep(page).getByRole('button', { name: 'Check my text' })).toBeVisible({
    timeout: 15_000,
  });
  // Time for a second download, if one had started, to ask for its files.
  await page.waitForTimeout(1_000);
  expect(Object.fromEntries(fetched)).toEqual(
    Object.fromEntries([...names, 'model-1', 'model-2'].map((name) => [file(name).path, 1])),
  );
});

test('says what it’s doing while the list of files comes, and when it can’t come', async ({
  page,
}) => {
  // On a network that hangs (a dead Wi-Fi, a VPN with no route), the list of
  // files never comes: the button stayed busy, without a word, for ever
  // (audit 3 G-7). Here the time limit (20 seconds) runs out when the test
  // says so.
  await page.addInitScript(() => {
    const limits: AbortController[] = [];
    AbortSignal.timeout = () => {
      const controller = new AbortController();
      limits.push(controller);
      return controller.signal;
    };
    const runOut = () => {
      for (const controller of limits) {
        controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
      }
    };
    Object.assign(window, { runOut });
  });
  await page.route(`**${DIR}manifest.json`, () => new Promise<void>(() => undefined));
  await page.goto('/');
  await downloadButton(page).click();
  const checking = 'Checking what to download…';
  await expect(deep(page).getByText(checking)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: checking })).toBeAttached();
  await expect(downloadButton(page)).toHaveAttribute('aria-disabled', 'true');

  await page.evaluate(() => {
    (Reflect.get(window, 'runOut') as () => void)();
  });
  const problem = 'Couldn’t reach the server. Check your internet connection and try again.';
  await expect(deep(page).locator('[data-deep-problem]')).toHaveText(problem);
  await expect(page.getByRole('status').filter({ hasText: problem })).toBeAttached();
  await expect(deep(page).getByText(checking)).toBeHidden();
  await expect(downloadButton(page)).not.toHaveAttribute('aria-disabled');
  await expect(downloadButton(page)).toBeFocused();
});

test('after a double tap, “Stop the download” stops the download', async ({ page }) => {
  const fetched = await standIns(page, 400);
  await page.goto('/');
  await downloadButton(page).dblclick();
  await deep(page).getByRole('button', { name: 'Stop the download' }).click();
  await expect(deep(page).locator('[data-deep-problem]')).toHaveText(/^Download stopped\./);
  const total = () => [...fetched.values()].reduce((sum, count) => sum + count, 0);
  const atStop = total();
  await page.waitForTimeout(2_000);
  expect(total()).toBe(atStop);
  await expect(downloadButton(page)).toBeVisible();
});
