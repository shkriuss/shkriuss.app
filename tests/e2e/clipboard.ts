/**
 * Pasting in browser tests, as a person does: the text goes on the clipboard,
 * then Ctrl+V (⌘V on a Mac) in the box. Unlike fill(), a paste is cut by the
 * box's maxlength, as it is for people (audit F3-3).
 */
import type { Locator } from '@playwright/test';

/** Pastes `text` into `box` from the clipboard. */
export async function paste(box: Locator, text: string): Promise<void> {
  const page = box.page();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await box.focus();
  await page.keyboard.press('ControlOrMeta+V');
}
