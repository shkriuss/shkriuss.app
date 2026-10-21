/**
 * Trades' data and rules, kept separate from the page so they're easy to
 * test. Every function returns new data instead of changing the old.
 *
 * A trade is a symbol, long or short, when and at what price it was entered,
 * how many, and (once it's closed) when and at what price it was exited.
 * Optional: a stop loss (for the result in R: how many times the risk was
 * won or lost), fees, a setup name ("Breakout") and notes. Amounts are in
 * one currency, chosen in the settings (saved only once changed, like
 * Water's, so a new device has nothing to win over another's when syncing).
 */
import { addDays, isIsoDate, type IsoDate } from '@shkriuss/dates';

export type Side = 'long' | 'short';
export const SIDES: readonly Side[] = ['long', 'short'];
export const SIDE_LABELS: Record<Side, string> = { long: 'Long', short: 'Short' };

export interface Trade {
  id: string;
  /** Upper case, like "AAPL" or "EURUSD". */
  symbol: string;
  side: Side;
  entryDate: IsoDate;
  entryPrice: number;
  quantity: number;
  /** The stop loss price, if one was set. */
  stop: number | null;
  /** Both null while the trade is open. */
  exitDate: IsoDate | null;
  exitPrice: number | null;
  /** All fees and commissions for the trade, in total. */
  fees: number;
  /** A name for the kind of trade ("Breakout"), or "". */
  setup: string;
  notes: string;
}

export interface TradesState {
  trades: Trade[];
}

export const LIMITS = { symbol: 20, setup: 40, notes: 1000, trades: 2000 };

export const emptyTrades = (): TradesState => ({ trades: [] });

// ---------- Checking ----------

const isPrice = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

function isTrade(value: unknown): value is Trade {
  if (typeof value !== 'object' || value === null) return false;
  const trade = value as Record<string, unknown>;
  const open = trade['exitDate'] === null && trade['exitPrice'] === null;
  const closed = isIsoDate(trade['exitDate']) && isPrice(trade['exitPrice']);
  return (
    typeof trade['id'] === 'string' &&
    trade['id'] !== '' &&
    typeof trade['symbol'] === 'string' &&
    SIDES.includes(trade['side'] as Side) &&
    isIsoDate(trade['entryDate']) &&
    isPrice(trade['entryPrice']) &&
    isPrice(trade['quantity']) &&
    (trade['stop'] === null || isPrice(trade['stop'])) &&
    (open || closed) &&
    typeof trade['fees'] === 'number' &&
    Number.isFinite(trade['fees']) &&
    trade['fees'] >= 0 &&
    typeof trade['setup'] === 'string' &&
    typeof trade['notes'] === 'string'
  );
}

/** True when saved trades have the shape Trades expects (limits apply when saving, not here). */
export function isTradesState(value: unknown): value is TradesState {
  if (typeof value !== 'object' || value === null) return false;
  const { trades } = value as Record<string, unknown>;
  return Array.isArray(trades) && trades.every(isTrade);
}

/** A trade as typed in the form: every field as text. */
export interface TradeForm {
  symbol: string;
  side: string;
  entryDate: string;
  entryPrice: string;
  quantity: string;
  stop: string;
  exitDate: string;
  exitPrice: string;
  fees: string;
  setup: string;
  notes: string;
}

export type Problems = Partial<Record<keyof TradeForm, string>>;

/** A typed number: null when empty, NaN when it isn't one. */
const parseNumber = (text: string): number | null =>
  text.trim() === '' ? null : Number(text.trim());

/**
 * Reads the form into a trade (with the given id), or says what's wrong,
 * field by field. `count` is how many other trades there are.
 */
export function readTrade(
  form: TradeForm,
  id: string,
  count: number,
): { trade: Trade; problems?: undefined } | { trade?: undefined; problems: Problems } {
  const problems: Problems = {};
  const symbol = form.symbol.trim().toUpperCase();
  if (symbol === '') problems.symbol = 'Enter the symbol, like AAPL.';
  else if (symbol.length > LIMITS.symbol) {
    problems.symbol = `Use ${LIMITS.symbol} characters or fewer.`;
  } else if (count >= LIMITS.trades) {
    problems.symbol = `You can keep up to ${LIMITS.trades} trades.`;
  }
  const side = SIDES.find((entry) => entry === form.side);
  if (!side) problems.side = 'Choose long or short.';
  if (!isIsoDate(form.entryDate)) problems.entryDate = 'Choose the day you entered.';

  const price = (field: 'entryPrice' | 'exitPrice' | 'stop', missing: string): number | null => {
    const value = parseNumber(form[field]);
    if (value === null) {
      if (missing) problems[field] = missing;
      return null;
    }
    if (!isPrice(value)) {
      problems[field] = 'Enter a number above 0.';
      return null;
    }
    return value;
  };
  const entryPrice = price('entryPrice', 'Enter the entry price.');
  const quantityValue = parseNumber(form.quantity);
  const quantity = isPrice(quantityValue) ? quantityValue : null;
  if (quantityValue === null) problems.quantity = 'Enter how many.';
  else if (quantity === null) problems.quantity = 'Enter a number above 0.';

  const stop = price('stop', '');
  if (stop !== null && entryPrice !== null && side) {
    if (side === 'long' && stop >= entryPrice) {
      problems.stop = 'For a long trade, the stop loss is below the entry price.';
    }
    if (side === 'short' && stop <= entryPrice) {
      problems.stop = 'For a short trade, the stop loss is above the entry price.';
    }
  }

  const exitGiven = form.exitDate.trim() !== '' || form.exitPrice.trim() !== '';
  let exitDate: IsoDate | null = null;
  let exitPrice: number | null = null;
  if (exitGiven) {
    exitPrice = price('exitPrice', 'Enter the exit price, or leave both empty.');
    if (!isIsoDate(form.exitDate)) {
      problems.exitDate = 'Choose the day you exited, or leave both empty.';
    } else if (isIsoDate(form.entryDate) && form.exitDate < form.entryDate) {
      problems.exitDate = 'The exit can’t be before the entry.';
    } else {
      exitDate = form.exitDate;
    }
  }

  const feesValue = parseNumber(form.fees);
  const fees = feesValue ?? 0;
  if (!Number.isFinite(fees) || fees < 0) problems.fees = 'Enter 0 or more.';

  const setup = form.setup.trim();
  if (setup.length > LIMITS.setup) problems.setup = `Use ${LIMITS.setup} characters or fewer.`;
  const notes = form.notes.trim();
  if (notes.length > LIMITS.notes) problems.notes = `Use ${LIMITS.notes} characters or fewer.`;

  if (Object.keys(problems).length > 0 || !side || entryPrice === null || quantity === null) {
    return { problems };
  }
  return {
    trade: {
      id,
      symbol,
      side,
      entryDate: form.entryDate,
      entryPrice,
      quantity,
      stop,
      exitDate,
      exitPrice,
      fees,
      setup,
      notes,
    },
  };
}

/** A trade as the form shows it. */
export const toForm = (trade: Trade): TradeForm => ({
  symbol: trade.symbol,
  side: trade.side,
  entryDate: trade.entryDate,
  entryPrice: String(trade.entryPrice),
  quantity: String(trade.quantity),
  stop: trade.stop === null ? '' : String(trade.stop),
  exitDate: trade.exitDate ?? '',
  exitPrice: trade.exitPrice === null ? '' : String(trade.exitPrice),
  fees: trade.fees === 0 ? '' : String(trade.fees),
  setup: trade.setup,
  notes: trade.notes,
});

// ---------- Changing ----------

/** Adds a trade, or puts a changed one in its place. */
export function saveTrade(state: TradesState, trade: Trade): TradesState {
  const exists = state.trades.some((entry) => entry.id === trade.id);
  return {
    trades: exists
      ? state.trades.map((entry) => (entry.id === trade.id ? trade : entry))
      : [...state.trades, trade],
  };
}

export const removeTrade = (state: TradesState, id: string): TradesState => ({
  trades: state.trades.filter((trade) => trade.id !== id),
});

// ---------- Results ----------

/** Rounds away the tiny errors of decimal sums (0.1 + 0.2). */
const tidy = (value: number): number => Math.round(value * 1e8) / 1e8;

export const isOpen = (trade: Trade): boolean => trade.exitPrice === null;

/** The result after fees, or null while the trade is open. */
export function profit(trade: Trade): number | null {
  if (trade.exitPrice === null) return null;
  const direction = trade.side === 'long' ? 1 : -1;
  return tidy((trade.exitPrice - trade.entryPrice) * trade.quantity * direction - trade.fees);
}

/** The result as a percentage of what was put in, or null while open. */
export function returnPercent(trade: Trade): number | null {
  const result = profit(trade);
  return result === null ? null : tidy((result / (trade.entryPrice * trade.quantity)) * 100);
}

/** The result in R (times the risk to the stop loss), or null without one. */
export function rMultiple(trade: Trade): number | null {
  const result = profit(trade);
  if (result === null || trade.stop === null) return null;
  return tidy(result / (Math.abs(trade.entryPrice - trade.stop) * trade.quantity));
}

export type Period = 'all' | 'this-month' | 'last-month' | 'this-year';
export const PERIODS: readonly Period[] = ['all', 'this-month', 'last-month', 'this-year'];
export const PERIOD_LABELS: Record<Period, string> = {
  all: 'All time',
  'this-month': 'This month',
  'last-month': 'Last month',
  'this-year': 'This year',
};

/** Closed trades, by the day they were exited, in a period. */
export function closedIn(state: TradesState, period: Period, today: IsoDate): Trade[] {
  const month = today.slice(0, 7);
  const lastMonth = addDays(`${month}-01`, -1).slice(0, 7);
  return state.trades.filter((trade) => {
    if (trade.exitDate === null) return false;
    if (period === 'this-month') return trade.exitDate.startsWith(month);
    if (period === 'last-month') return trade.exitDate.startsWith(lastMonth);
    if (period === 'this-year') return trade.exitDate.startsWith(today.slice(0, 4));
    return true;
  });
}

export interface Stats {
  count: number;
  wins: number;
  losses: number;
  /** Wins out of all closed trades, 0 to 1 (null with none). */
  winRate: number | null;
  total: number;
  averageWin: number | null;
  /** Negative. */
  averageLoss: number | null;
  /** What was won for each 1 lost (null without losses). */
  profitFactor: number | null;
  best: Trade | null;
  worst: Trade | null;
  /** Over the trades with a stop loss (null with none). */
  averageR: number | null;
}

export function stats(trades: readonly Trade[]): Stats {
  const results = trades.flatMap((trade) => {
    const result = profit(trade);
    return result === null ? [] : [{ trade, result }];
  });
  const won = results.filter((entry) => entry.result > 0);
  const lost = results.filter((entry) => entry.result < 0);
  const sum = (entries: { result: number }[]) =>
    tidy(entries.reduce((total, entry) => total + entry.result, 0));
  const grossWin = sum(won);
  const grossLoss = -sum(lost);
  const rs = trades.flatMap((trade) => {
    const r = rMultiple(trade);
    return r === null ? [] : [r];
  });
  const sorted = [...results].sort((a, b) => b.result - a.result);
  return {
    count: results.length,
    wins: won.length,
    losses: lost.length,
    winRate: results.length === 0 ? null : won.length / results.length,
    total: sum(results),
    averageWin: won.length === 0 ? null : tidy(grossWin / won.length),
    averageLoss: lost.length === 0 ? null : tidy(-grossLoss / lost.length),
    profitFactor: grossLoss === 0 ? null : tidy(grossWin / grossLoss),
    best: sorted[0]?.trade ?? null,
    worst: sorted.at(-1)?.trade ?? null,
    averageR: rs.length === 0 ? null : tidy(rs.reduce((total, r) => total + r, 0) / rs.length),
  };
}

export interface Group {
  /** A setup name ("" = none), or a month ("2026-10"). */
  key: string;
  count: number;
  wins: number;
  total: number;
}

function groupBy(trades: readonly Trade[], keyOf: (trade: Trade) => string): Group[] {
  const groups = new Map<string, Group>();
  for (const trade of trades) {
    const result = profit(trade);
    if (result === null) continue;
    const key = keyOf(trade);
    const group = groups.get(key) ?? { key, count: 0, wins: 0, total: 0 };
    group.count += 1;
    if (result > 0) group.wins += 1;
    group.total = tidy(group.total + result);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Results for each setup, the best first. */
export const bySetup = (trades: readonly Trade[]): Group[] =>
  groupBy(trades, (trade) => trade.setup).sort(
    (a, b) => b.total - a.total || a.key.localeCompare(b.key),
  );

/** Results for each month (by exit day), the latest first. */
export const byMonth = (trades: readonly Trade[]): Group[] =>
  groupBy(trades, (trade) => (trade.exitDate ?? '').slice(0, 7)).sort((a, b) =>
    b.key.localeCompare(a.key),
  );

// ---------- Lists ----------

/** Open trades, the latest entered first. */
export const openTrades = (state: TradesState): Trade[] =>
  state.trades
    .filter(isOpen)
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate) || a.symbol.localeCompare(b.symbol));

/** Closed trades, the latest exited first. */
export const closedTrades = (trades: readonly Trade[]): Trade[] =>
  trades
    .filter((trade) => !isOpen(trade))
    .sort(
      (a, b) =>
        (b.exitDate ?? '').localeCompare(a.exitDate ?? '') ||
        b.entryDate.localeCompare(a.entryDate),
    );

/** Text for comparing: lower case and without accents. */
const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** True if every word typed is in the trade's symbol, setup or notes. */
export function matchesSearch(trade: Trade, query: string): boolean {
  const haystack = fold(`${trade.symbol} ${trade.setup} ${trade.notes}`);
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** The setups used so far, for suggestions, in alphabetical order. */
export const setupNames = (state: TradesState): string[] =>
  [...new Set(state.trades.map((trade) => trade.setup).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

// ---------- Money and numbers for people ----------

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'GEL', 'CHF', 'JPY', 'CAD', 'AUD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** "$1,234.50"; with `signed`, "+$480.00" or "-$120.00". */
export function formatMoney(
  amount: number,
  currency: Currency,
  options: { signed?: boolean; locale?: string } = {},
): string {
  return new Intl.NumberFormat(options.locale, {
    style: 'currency',
    currency,
    signDisplay: options.signed ? 'exceptZero' : 'auto',
  }).format(amount);
}

/** A price or amount, with as many decimals as it has (up to 8). */
export const formatNumber = (value: number, locale?: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 8 }).format(value);

/** "+3.2%", "-1.05%". */
export const formatPercent = (value: number, locale?: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(
    value,
  ) + '%';

/** "+2.0R", "-1.0R". */
export const formatR = (value: number): string =>
  `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toFixed(1)}R`;

/** "October 2026". */
export function monthLabel(month: string, locale?: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(year, number - 1, 1));
}

/** "Oct 19, 2026"-style dates. */
export function dateLabel(date: IsoDate, locale?: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    Date.UTC(year, month - 1, day),
  );
}

// ---------- Spreadsheet ----------

/** A spreadsheet cell: quoted when needed, and never read as a formula. */
function cell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The trades as a CSV file (one row each, the latest entered first). */
export function toCsv(state: TradesState): string {
  const header = [
    'Symbol',
    'Side',
    'Entry date',
    'Entry price',
    'Quantity',
    'Stop loss',
    'Exit date',
    'Exit price',
    'Fees',
    'Net result',
    'Return %',
    'R',
    'Setup',
    'Notes',
  ];
  const rows = [...state.trades]
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate))
    .map((trade) =>
      [
        trade.symbol,
        SIDE_LABELS[trade.side],
        trade.entryDate,
        trade.entryPrice,
        trade.quantity,
        trade.stop,
        trade.exitDate,
        trade.exitPrice,
        trade.fees,
        profit(trade),
        returnPercent(trade),
        rMultiple(trade),
        trade.setup,
        trade.notes,
      ]
        .map(cell)
        .join(','),
    );
  return [header.join(','), ...rows].join('\r\n') + '\r\n';
}

// ---------- Settings ----------

export interface Setting {
  id: 'currency';
  currency: Currency;
}

export interface SettingsState {
  /** Only the settings ever changed. */
  settings: Setting[];
}

export const emptySettings = (): SettingsState => ({ settings: [] });

const isSetting = (value: unknown): value is Setting =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<string, unknown>)['id'] === 'currency' &&
  CURRENCIES.includes((value as Record<string, unknown>)['currency'] as Currency);

export function isSettingsState(value: unknown): value is SettingsState {
  if (typeof value !== 'object' || value === null) return false;
  const { settings } = value as Record<string, unknown>;
  return Array.isArray(settings) && settings.every(isSetting);
}

/** Settings from sync: the ones that look right. */
export const withSettings = (items: readonly unknown[]): SettingsState => ({
  settings: items.filter(isSetting).slice(0, 1),
});

export const currencyOf = (state: SettingsState): Currency =>
  state.settings.find((setting) => setting.id === 'currency')?.currency ?? 'USD';

export const setCurrency = (state: SettingsState, currency: Currency): SettingsState =>
  CURRENCIES.includes(currency)
    ? {
        settings: [
          ...state.settings.filter((setting) => setting.id !== 'currency'),
          { id: 'currency', currency },
        ],
      }
    : state;
