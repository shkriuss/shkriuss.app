// Water for people who use Windows contrast themes or a screen reader.
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { MAX_DRINKS_PER_DAY } from '../src/lib/water.ts';
import { drink, NOW, otherDialog, seed, TIME_ZONE, TODAY } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

test('the goal’s bar still shows how far it is in a contrast theme', async ({ page }) => {
  // Contrast themes replace backgrounds, and the bar showed empty (audit G-14).
  await seed(page, { drinks: [drink(TODAY, '09:00', 1000)] });
  await page.emulateMedia({ forcedColors: 'active' });
  // Half of the 2,000 ml goal: the colour drawn a fifth of the way along, and four fifths.
  const picture = await page.locator('[data-progress]').screenshot();
  const [done, notYet] = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (letter) => letter.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const context = new OffscreenCanvas(image.width, image.height).getContext('2d');
    if (!context) throw new Error('No canvas');
    context.drawImage(image, 0, 0);
    const at = (share: number) =>
      [...context.getImageData(image.width * share, image.height / 2, 1, 1).data].join();
    return [at(0.2), at(0.8)];
  }, picture.toString('base64'));
  expect(done).not.toBe(notYet);
});

test('a day that is full says so, read with the Day field', async ({ page }) => {
  // The problem wasn't tied to the field, so moving to it didn't read it (audit G-14).
  await seed(page, {
    drinks: Array.from({ length: MAX_DRINKS_PER_DAY }, (_, index) =>
      drink(TODAY, `0${Math.floor(index / 10)}:${String((index % 10) * 5).padStart(2, '0')}`, 10),
    ),
  });
  await page.getByRole('button', { name: 'Other amount' }).click();
  const dialog = otherDialog(page);
  await dialog.getByLabel(/^Amount/).fill('100');
  await dialog.getByLabel('Time').fill('09:30');
  await dialog.getByRole('button', { name: 'Add' }).click();
  const day = dialog.getByLabel('Day');
  await expect(day).toBeFocused();
  await expect(day).toHaveAccessibleDescription(
    `You can log up to ${MAX_DRINKS_PER_DAY} drinks a day.`,
  );
});
