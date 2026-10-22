import { apps, appOrigin, hubOrigin, listedApps } from '@shkriuss/registry';
import { expect, test } from '../../../tests/e2e/fixtures.ts';

test('lists every listed app from the registry, linking to its subdomain', async ({ page }) => {
  await page.goto('/');
  const list = page.getByRole('region', { name: 'Apps' }).getByRole('list');
  await expect(list.getByRole('listitem')).toHaveCount(listedApps.length);
  // In alphabetical order.
  const names = listedApps.map((app) => app.name).sort((a, b) => a.localeCompare(b, 'en'));
  await expect(list.getByRole('heading', { level: 3 })).toHaveText(names);
  for (const app of listedApps) {
    const link = list.getByRole('link', { name: app.name, exact: true });
    await expect(link).toHaveAttribute('href', `${appOrigin(app.slug)}/`);
  }
});

test('the privacy page lists what every app stores', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy' }).click();
  await expect(page).toHaveURL(/\/privacy\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible();

  const table = page.getByRole('table');
  for (const app of apps) {
    const row = table.getByRole('row', { name: new RegExp(`^${app.name}\\b`) });
    await expect(row).toBeVisible();
    for (const item of app.dataStored) await expect(row).toContainText(item);
  }
});

test('says where to report a security problem (security.txt)', async ({ request }) => {
  const response = await request.get('/.well-known/security.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^text\/plain/);
  const text = await response.text();
  expect(text).toContain(
    'Contact: https://github.com/shkriuss/shkriuss.app/security/advisories/new',
  );
  expect(text).toContain(`Canonical: ${hubOrigin}/.well-known/security.txt`);
  // RFC 9116: "Expires" must be in the future, and less than a year away.
  const expires = Date.parse(/^Expires: (.+)$/m.exec(text)?.[1] ?? '');
  expect(expires).toBeGreaterThan(Date.now() + 30 * 24 * 60 * 60 * 1000);
  expect(expires).toBeLessThan(Date.now() + 365 * 24 * 60 * 60 * 1000);
});
