// Shared by Trades' browser tests: the day it is, finding things on the
// page, filling in the trade form, and saving trades straight into storage.
import type { Page } from '@playwright/test';
import { seedStores } from '../../../tests/e2e/storage.ts';
import { TRADES_VERSION, type Trade } from '../src/lib/trades.ts';

/** Wednesday 21 October 2026, 10:00 in Tbilisi (the tests' time zone). */
export const NOW = new Date('2026-10-21T10:00:00+04:00');
export const TIME_ZONE = 'Asia/Tbilisi';

export const tradeDialog = (page: Page) => page.locator('[data-trade-dialog]');
/** A trade in the open or closed list, by its symbol. */
export const tradeItem = (page: Page, symbol: string) =>
  page.locator('li[data-id]').filter({ has: page.locator('[data-symbol]', { hasText: symbol }) });
/** A results tile's value, by its label ("Net result"). */
export const tile = (page: Page, label: string) =>
  page.locator('.tile').filter({ hasText: label }).locator('[data-value]');
export const yearDialog = (page: Page) => page.getByRole('dialog', { name: 'Delete a year' });

/** Fills in the open trade form (only the fields given) and saves. */
export async function fillTrade(
  page: Page,
  fields: {
    symbol?: string;
    side?: 'Long' | 'Short';
    entryDate?: string;
    entryPrice?: string;
    quantity?: string;
    stop?: string;
    exitDate?: string;
    exitPrice?: string;
    /** "Quantity closed" (only while closing). */
    closeQuantity?: string;
    fees?: string;
    setup?: string;
    notes?: string;
  },
): Promise<void> {
  const dialog = tradeDialog(page);
  const entry = dialog.getByRole('group', { name: 'Entry' });
  const exit = dialog.getByRole('group', { name: 'Exit' });
  if (fields.closeQuantity !== undefined) {
    await exit.getByLabel('Quantity closed').fill(fields.closeQuantity);
  }
  if (fields.symbol !== undefined) await dialog.getByLabel('Symbol').fill(fields.symbol);
  if (fields.side) await dialog.getByLabel(fields.side, { exact: true }).check();
  if (fields.entryDate !== undefined) await entry.getByLabel('Day').fill(fields.entryDate);
  if (fields.entryPrice !== undefined) await entry.getByLabel('Price').fill(fields.entryPrice);
  if (fields.quantity !== undefined) await entry.getByLabel('Quantity').fill(fields.quantity);
  if (fields.stop !== undefined) await entry.getByLabel('Stop loss (optional)').fill(fields.stop);
  if (fields.exitDate !== undefined) await exit.getByLabel('Day').fill(fields.exitDate);
  if (fields.exitPrice !== undefined) await exit.getByLabel('Price').fill(fields.exitPrice);
  if (fields.fees !== undefined) await exit.getByLabel('Fees (optional)').fill(fields.fees);
  if (fields.setup !== undefined) await dialog.getByLabel('Setup (optional)').fill(fields.setup);
  if (fields.notes !== undefined) await dialog.getByLabel('Notes (optional)').fill(fields.notes);
  await dialog.getByRole('button', { name: 'Save' }).click();
}

/** A closed trade, as saved (open: no exit). */
export const trade = (overrides: Partial<Trade>): Trade => ({
  id: crypto.randomUUID(),
  symbol: 'AAPL',
  side: 'long',
  entryDate: '2026-10-01',
  entryPrice: 100,
  quantity: 10,
  stop: null,
  exitDate: '2026-10-05',
  exitPrice: 110,
  fees: 0,
  setup: '',
  notes: '',
  ...overrides,
});

/** Saves trades straight into storage, then reloads. */
export async function seed(page: Page, trades: Trade[]): Promise<void> {
  await seedStores(page, { trades: { version: TRADES_VERSION, data: { trades } } });
}
