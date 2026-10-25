// Deep check's download, with small stand-in files instead of the model (so
// this is quick; deep-check.spec.ts downloads the real one): a second tap on
// "Download Deep check" while the list of files comes doesn't download
// everything twice, and "Stop the download" stops it (audit F3-5). The list
// takes 300 ms, like a phone network.
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

/** Serves the stand-in files, each after `delay` ms; returns how often each was asked for. */
async function standIns(page: Page, delay: number): Promise<Map<string, number>> {
  const fetched = new Map<string, number>();
  await page.route(`**${DIR}**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `${DIR}manifest.json`) {
      await new Promise((resolve) => setTimeout(resolve, 300));
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
  const fetched = await standIns(page, 200);
  await page.goto('/');
  await expect(downloadButton(page)).toBeVisible();
  await downloadButton(page).click();
  // Busy while the list of files comes: it keeps focus, and another tap does nothing.
  await expect(downloadButton(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(downloadButton(page)).toBeFocused();
  await downloadButton(page).dispatchEvent('click');
  await expect(deep(page).getByRole('button', { name: 'Check my text' })).toBeVisible({
    timeout: 15_000,
  });
  // Time for a second download, if one had started, to ask for its files.
  await page.waitForTimeout(1_000);
  expect(Object.fromEntries(fetched)).toEqual(
    Object.fromEntries([...names, 'model-1', 'model-2'].map((name) => [file(name).path, 1])),
  );
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
