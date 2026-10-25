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
 *
 * Closing part of an open trade splits it in two (readClose): the part
 * closed, and the rest, still open.
 */
import { addDays, isIsoDate, type IsoDate } from '@shkriuss/dates';
import {
  CURRENCIES,
  decimalText,
  formatMoney,
  parseDecimal,
  type Currency,
} from '@shkriuss/ui/numbers';
import { DATE_LOCALE } from '@shkriuss/ui/locale';
import { foldText } from '@shkriuss/ui/text';

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

/** The trades' data version. */
export const TRADES_VERSION = 1;

export const LIMITS = {
  symbol: 20,
  setup: 40,
  notes: 1000,
  /**
   * The most trades kept, open and closed, so they fit on the device and in
   * the sync copy (measured in trades.test.ts: "room for every trade").
   */
  trades: 3500,
  /** The biggest price, quantity or fee (results stay exact far beyond it). */
  number: 1e12,
};

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

/**
 * Reads the form into a trade (with the given id), or says what's wrong,
 * field by field. `count` is how many other trades there are. Numbers are
 * read as typed in `locale` (the browser's own when left out): "1,25" is
 * 1.25, and "1,250" is 1250 in English (parseDecimal).
 */
export function readTrade(
  form: TradeForm,
  id: string,
  count: number,
  locale?: string,
): { trade: Trade; problems?: undefined } | { trade?: undefined; problems: Problems } {
  const parseNumber = (text: string) => parseDecimal(text, locale);
  const problems: Problems = {};
  const symbol = form.symbol.trim().toUpperCase();
  if (symbol === '') problems.symbol = 'Enter the symbol, like AAPL.';
  else if (symbol.length > LIMITS.symbol) {
    problems.symbol = `Use ${LIMITS.symbol} characters or fewer.`;
  } else if (count >= LIMITS.trades) {
    problems.symbol = `You can keep up to ${new Intl.NumberFormat().format(LIMITS.trades)} trades. To make room, delete a year (under Currency and spreadsheet).`;
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
    if (value > LIMITS.number) {
      problems[field] = 'Enter a smaller number.';
      return null;
    }
    return value;
  };
  const entryPrice = price('entryPrice', 'Enter the entry price.');
  const quantityValue = parseNumber(form.quantity);
  const quantity = isPrice(quantityValue) ? quantityValue : null;
  if (quantityValue === null) problems.quantity = 'Enter how many.';
  else if (quantity === null) problems.quantity = 'Enter a number above 0.';
  else if (quantity > LIMITS.number) problems.quantity = 'Enter a smaller number.';

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
  else if (fees > LIMITS.number) problems.fees = 'Enter a smaller number.';

  // One setup however it's typed: "Breakout  retest" is "Breakout retest".
  const setup = form.setup.replace(/\s+/g, ' ').trim();
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

/** What's wrong in the close form: the trade form's problems, and "Quantity closed". */
export type CloseProblems = Problems & { closeQuantity?: string };

/**
 * Reads the close form: the trade form, and how many of the trade were
 * closed (`closeQuantity`: the whole trade unless it's changed). Closing
 * all of it saves the trade with its exit, as readTrade does. Closing part
 * of it splits it in two:
 * - `trade`: the part closed, a new trade (`ids.newId`) with that quantity,
 *   the exit, and the fees typed in;
 * - `rest`: the rest of the quantity, still open, with the trade's own id
 *   (`ids.id`), the same entry and stop loss, and no fees (they're the
 *   closed part's, so they aren't counted twice).
 * `count` is how many other trades there are; numbers are read as in readTrade.
 */
export function readClose(
  form: TradeForm,
  closeQuantity: string,
  ids: { id: string; newId: string },
  count: number,
  locale?: string,
):
  | { trade: Trade; rest: Trade | null; problems?: undefined }
  | { trade?: undefined; rest?: undefined; problems: CloseProblems } {
  const read = readTrade(form, ids.id, count, locale);
  const problems: CloseProblems = { ...read.problems };
  const whole = parseDecimal(form.quantity, locale);
  const closed = parseDecimal(closeQuantity, locale);
  if (closed === null) problems.closeQuantity = 'Enter how many you closed.';
  else if (!isPrice(closed)) problems.closeQuantity = 'Enter a number above 0.';
  else if (isPrice(whole) && closed > whole) {
    problems.closeQuantity = 'Enter no more than the trade’s quantity.';
  }
  const rest = isPrice(whole) && isPrice(closed) ? tidy(whole - closed) : 0;
  if (rest > 0 && !problems.closeQuantity) {
    if (form.exitDate.trim() === '' && form.exitPrice.trim() === '') {
      problems.exitPrice = 'Enter the exit price, to close part of the trade.';
    } else if (count + 1 >= LIMITS.trades) {
      problems.closeQuantity = `You can keep up to ${new Intl.NumberFormat().format(LIMITS.trades)} trades, so close all of it, or make room first.`;
    }
  }
  if (!read.trade || Object.keys(problems).length > 0) return { problems };
  if (rest <= 0) return { trade: read.trade, rest: null };
  return {
    trade: { ...read.trade, id: ids.newId, quantity: closed as number },
    rest: { ...read.trade, quantity: rest, exitDate: null, exitPrice: null, fees: 0 },
  };
}

/**
 * A trade as the form shows it: numbers as they'd be typed in `locale` (the
 * browser's own when left out), with all their digits and never an exponent
 * ("0.0000000015", not "1.5e-9"), so saving the form unchanged keeps them.
 */
export function toForm(trade: Trade, locale?: string): TradeForm {
  const number = (value: number) => decimalText(value, locale);
  return {
    symbol: trade.symbol,
    side: trade.side,
    entryDate: trade.entryDate,
    entryPrice: number(trade.entryPrice),
    quantity: number(trade.quantity),
    stop: trade.stop === null ? '' : number(trade.stop),
    exitDate: trade.exitDate ?? '',
    exitPrice: trade.exitPrice === null ? '' : number(trade.exitPrice),
    fees: trade.fees === 0 ? '' : number(trade.fees),
    setup: trade.setup,
    notes: trade.notes,
  };
}

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

/** Closing part of an open trade (readClose): the part closed, and the rest of it, still open. */
export const closePart = (state: TradesState, closed: Trade, rest: Trade): TradesState =>
  saveTrade(saveTrade(state, rest), closed);

// ---------- Making room ----------

export interface YearCount {
  /** "2024". */
  year: string;
  count: number;
}

/** The year a trade was closed in, or null while it's open. */
const closedYear = (trade: Trade): string | null => trade.exitDate?.slice(0, 4) ?? null;

/**
 * The years trades were closed in (by the day they were exited, like the
 * results), the earliest first, with how many each (for "Delete a year").
 */
export function closedYears(state: TradesState): YearCount[] {
  const counts = new Map<string, number>();
  for (const trade of state.trades) {
    const year = closedYear(trade);
    if (year !== null) counts.set(year, (counts.get(year) ?? 0) + 1);
  }
  return [...counts]
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year.localeCompare(b.year));
}

/** Removes the trades closed in a year ("2024"). Open trades always stay. */
export const removeClosedYear = (state: TradesState, year: string): TradesState => ({
  trades: state.trades.filter((trade) => closedYear(trade) !== year),
});

/** "1 closed trade", "312 closed trades". */
export const closedCount = (count: number, locale?: string): string =>
  `${new Intl.NumberFormat(locale).format(count)} closed ${count === 1 ? 'trade' : 'trades'}`;

/**
 * What the page says once Trades is nearly full (over 90% of the trades it
 * keeps, open and closed): how many more fit, and how to make room. Null
 * until then.
 */
export function roomNote(count: number, locale?: string): string | null {
  if (count <= LIMITS.trades * 0.9) return null;
  const left = LIMITS.trades - count;
  const most = new Intl.NumberFormat(locale).format(LIMITS.trades);
  const start =
    left > 0
      ? `Trades is nearly full: there’s room for ${new Intl.NumberFormat(locale).format(left)} more ${left === 1 ? 'trade' : 'trades'} (it keeps up to ${most}, open and closed).`
      : `Trades is full: it keeps up to ${most} trades, open and closed.`;
  return `${start} To make room, download the spreadsheet, then use “Delete a year…” under Currency and spreadsheet, below.`;
}

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

/**
 * Groups closed trades by `keyOf`. Keys that are the same by `same` (say,
 * "Breakout" and "breakout") are one group, named as first seen.
 */
function groupBy(
  trades: readonly Trade[],
  keyOf: (trade: Trade) => string,
  same: (key: string) => string = (key) => key,
): Group[] {
  const groups = new Map<string, Group>();
  for (const trade of trades) {
    const result = profit(trade);
    if (result === null) continue;
    const key = keyOf(trade);
    const group = groups.get(same(key)) ?? { key, count: 0, wins: 0, total: 0 };
    group.count += 1;
    if (result > 0) group.wins += 1;
    group.total = tidy(group.total + result);
    groups.set(same(key), group);
  }
  return [...groups.values()];
}

/** A setup's name with single spaces (older trades may have more). */
const setupName = (setup: string): string => setup.replace(/\s+/g, ' ').trim();
/** A setup's name for comparing: also lower case, without accents. */
const setupKey = (setup: string): string => fold(setupName(setup));

/** Results for each setup, the best first. */
export const bySetup = (trades: readonly Trade[]): Group[] =>
  groupBy(trades, (trade) => setupName(trade.setup), setupKey).sort(
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

/** Text for comparing: lower case and without accents (a Thai word keeps its tone marks). */
const fold = foldText;

/** True if every word typed is in the trade's symbol, setup or notes. */
export function matchesSearch(trade: Trade, query: string): boolean {
  const haystack = fold(`${trade.symbol} ${trade.setup} ${trade.notes}`);
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** The setups used so far, for suggestions, each once (as first typed), in alphabetical order. */
export function setupNames(state: TradesState): string[] {
  const names = new Map<string, string>();
  for (const { setup } of state.trades) {
    if (setup !== '' && !names.has(setupKey(setup))) names.set(setupKey(setup), setupName(setup));
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

// ---------- Money and numbers for people ----------

// The currencies and formatMoney are shared with Budget and Repairs.
export { CURRENCIES, formatMoney, type Currency };

/**
 * A price or amount, with as many decimals as it has (up to 8). Below 1, up
 * to 8 significant digits, so a price of 0.000000001234 isn't shown as 0.
 */
export const formatNumber = (value: number, locale?: string): string =>
  new Intl.NumberFormat(
    locale,
    Math.abs(value) < 1 ? { maximumSignificantDigits: 8 } : { maximumFractionDigits: 8 },
  ).format(value);

/**
 * A win rate as it's shown: in whole percent, except that it's never
 * rounded to 100% with a loss, or to 0% with a win (249 won of 250 is
 * 99.6%, not 100%). `digits` is how many decimals to show.
 */
export function shownRate(rate: number): { value: number; digits: number } {
  const whole = Math.round(rate * 100);
  if (whole === 100 && rate < 1) return { value: Math.floor(rate * 1000) / 1000, digits: 1 };
  if (whole === 0 && rate > 0) return { value: Math.ceil(rate * 1000) / 1000, digits: 1 };
  return { value: rate, digits: 0 };
}

/** "+3.2%", "-1.05%". */
export const formatPercent = (value: number, locale?: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(
    value,
  ) + '%';

/** "+2.0R", "-1.0R". */
export const formatR = (value: number): string =>
  `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toFixed(1)}R`;

/** "October 2026". */
export function monthLabel(month: string, locale = DATE_LOCALE): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(year, number - 1, 1));
}

/** "Oct 19, 2026"-style dates. */
export function dateLabel(date: IsoDate, locale = DATE_LOCALE): string {
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
