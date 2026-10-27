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
 * Closing part of an open trade (readClose) adds the part closed as a trade
 * of its own that names the trade it was closed off (`parent`). That trade
 * keeps its quantity, what was bought: what's still open of it is that less
 * its parts' (openQuantity). Nothing about it changes, so a change made to
 * it on another device at the same time can't bring back what was closed,
 * and parts closed on two devices both count. Closing more than was bought
 * that way (two devices closing all of it at once) shows as a problem on
 * the trade (overClosed), never as shares counted twice.
 */
import { addDays, isIsoDate, type IsoDate } from '@shkriuss/dates';
import { csvFile } from '@shkriuss/storage/csv';
import { defineSettings, type SettingsState as SavedSettings } from '@shkriuss/storage/settings';
import { withEdits } from '@shkriuss/sync/edits';
import {
  CURRENCIES,
  decimalText,
  formatMoney,
  parseDecimal,
  roundDecimal,
  whichAmount,
  type Currency,
  type MoneyOptions,
  type ParseOptions,
} from '@shkriuss/ui/numbers';
import { DATE_LOCALE } from '@shkriuss/ui/locale';
import { cutToLength, foldText } from '@shkriuss/ui/text';
import { roomNote as sharedRoomNote } from '@shkriuss/ui/room-note';

/**
 * How typed numbers are read: one comma or point before exactly three
 * digits could be either sign ("149,853" may be a price of 149.853, typed
 * on an iPhone keypad that offers its region's decimal sign; "1.500" in
 * French), so the person is asked which (audit 4 F2-10, F2-12).
 */
const UNSURE: ParseOptions = { groupsToo: true };
const readNumber = (text: string, locale?: string): number | null =>
  parseDecimal(text, locale, UNSURE);
/** What to ask about a number that could be two, else `otherwise`. */
const notANumber = (text: string, locale: string | undefined, otherwise: string): string =>
  whichAmount(text, locale, UNSURE) ?? otherwise;

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
  /**
   * Only on part of a trade closed on its own (readClose): the id of the
   * trade it was closed off, whose quantity stays what was bought.
   */
  parent?: string;
}

export interface TradesState {
  trades: Trade[];
}

/**
 * The trades' data version. Version 2 added parts that name their trade
 * (`parent`). What version 1 saved reads the same (migrateTrades: its parts
 * were trades of their own, with the rest's quantity made smaller), and a
 * Trades on another device that's still version 1 waits for its update
 * instead of syncing parts it would count twice.
 */
export const TRADES_VERSION = 2;

export const LIMITS = {
  symbol: 20,
  setup: 40,
  notes: 1000,
  /**
   * The most trades kept, open and closed, so they fit on the device and in
   * the sync copy (measured in trades.test.ts: "room for every trade").
   */
  trades: 3500,
  /**
   * The biggest price, quantity or fee. Results are worked out to 8
   * decimals (tidy), so with very big positions they can be a hair off:
   * 1,000,000 shares bought at $1,234.56 and sold at $1,234.57 make
   * $9,999.99999999, not $10,000 (audit 3 F2-11).
   */
  number: 1e12,
};

export const emptyTrades = (): TradesState => ({ trades: [] });

/**
 * Whether text fits a limit, counted as text boxes count their maxlength on
 * an iPhone: a flag, a family emoji or a letter with its accent is one
 * character, so what a full box holds is never refused on saving
 * (cutToLength). Before, each half of an emoji counted, and a setup of 6
 * family emoji was "Use 40 characters or fewer." (audit 5 F2-3).
 */
const fits = (text: string, max: number): boolean => cutToLength(text, max) === text;

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
    typeof trade['notes'] === 'string' &&
    (trade['parent'] === undefined ||
      (typeof trade['parent'] === 'string' &&
        trade['parent'] !== '' &&
        trade['parent'] !== trade['id']))
  );
}

/** True when saved trades have the shape Trades expects (limits apply when saving, not here). */
export function isTradesState(value: unknown): value is TradesState {
  if (typeof value !== 'object' || value === null) return false;
  const { trades } = value as Record<string, unknown>;
  return Array.isArray(trades) && trades.every(isTrade);
}

/** Trades saved by version 1, in this version's shape (the same: none is a part). */
export const migrateTrades = (old: unknown, version: number): TradesState | undefined =>
  version === 1 && isTradesState(old) ? old : undefined;

// ---------- Parts ----------

/** What was closed off a trade in parts: their quantities and fees, added up. */
export interface Parts {
  quantity: number;
  fees: number;
}

const NO_PARTS: Parts = { quantity: 0, fees: 0 };

/** What was closed off each trade in parts, by the trade's id (worked out once for a list). */
export function partsOf(trades: readonly Trade[]): Map<string, Parts> {
  const parts = new Map<string, Parts>();
  for (const { parent, quantity, fees } of trades) {
    if (parent === undefined) continue;
    const sum = parts.get(parent) ?? NO_PARTS;
    parts.set(parent, { quantity: tidy(sum.quantity + quantity), fees: tidy(sum.fees + fees) });
  }
  return parts;
}

/**
 * What's still open of a trade: its quantity less what its parts closed
 * (0 once it's closed itself). Below 0 when more was closed than bought.
 */
export const openQuantity = (trade: Trade, parts: ReadonlyMap<string, Parts>): number =>
  trade.exitPrice === null ? tidy(trade.quantity - (parts.get(trade.id)?.quantity ?? 0)) : 0;

/**
 * The trade's own fees not yet counted with a part: each part closed takes
 * the fees typed for it (the trade's own, unless changed), so they're never
 * counted twice.
 */
export const openFees = (trade: Trade, parts: ReadonlyMap<string, Parts>): number =>
  Math.max(0, tidy(trade.fees - (parts.get(trade.id)?.fees ?? 0)));

/**
 * How much more of a trade was closed than bought, or 0. It happens when
 * two devices close it, or parts of it, at the same time before they sync:
 * its own exit closes all it bought, and each part closes its quantity.
 */
export function overClosed(trade: Trade, parts: ReadonlyMap<string, Parts>): number {
  const split = parts.get(trade.id)?.quantity ?? 0;
  if (split === 0) return 0;
  const closed = tidy((trade.exitPrice === null ? 0 : trade.quantity) + split);
  return Math.max(0, tidy(closed - trade.quantity));
}

/**
 * What a trade, or a part of it, says when more of the trade was closed
 * than bought (overClosed); null when it wasn't. `byId`: every trade.
 */
export function overClosedNote(
  trade: Trade,
  parts: ReadonlyMap<string, Parts>,
  byId: ReadonlyMap<string, Trade>,
  locale?: string,
): string | null {
  const whole = trade.parent === undefined ? trade : byId.get(trade.parent);
  if (!whole) return null;
  const extra = overClosed(whole, parts);
  if (extra === 0) return null;
  const number = (value: number) => formatNumber(value, locale);
  return `${number(tidy(whole.quantity + extra))} closed of the ${number(whole.quantity)} bought: two devices may have closed it at the same time. Delete the close that’s wrong.`;
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
 * field by field. `count` is how many trades there are, for a new one; null
 * for a change to one kept already, which adds none, so it's never refused
 * for the limit: with more than that, after two devices' trades were put
 * together, any change was, and closing any trade (audit 3 F2-5). Numbers
 * are read as typed in `locale` (the browser's own when left out): "1,25"
 * is 1.25, "1,250,000" is 1250000 in English, and for "1,250" the person
 * is asked which they mean (UNSURE).
 */
export function readTrade(
  form: TradeForm,
  id: string,
  count: number | null,
  locale?: string,
): { trade: Trade; problems?: undefined } | { trade?: undefined; problems: Problems } {
  const parseNumber = (text: string) => readNumber(text, locale);
  const problems: Problems = {};
  const symbol = form.symbol.trim().toUpperCase();
  if (symbol === '') problems.symbol = 'Enter the symbol, like AAPL.';
  else if (!fits(symbol, LIMITS.symbol)) {
    problems.symbol = `Use ${LIMITS.symbol} characters or fewer.`;
  } else if (count !== null && count >= LIMITS.trades) {
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
    // Before "not a number": one too long to be one reads as infinite (audit 5 F2-5).
    if (value > LIMITS.number) {
      problems[field] = 'Enter a smaller number.';
      return null;
    }
    if (!isPrice(value)) {
      problems[field] = notANumber(form[field], locale, 'Enter a number above 0.');
      return null;
    }
    return value;
  };
  const entryPrice = price('entryPrice', 'Enter the entry price.');
  const quantityValue = parseNumber(form.quantity);
  const quantity = isPrice(quantityValue) ? quantityValue : null;
  if (quantityValue === null) problems.quantity = 'Enter how many.';
  else if (quantityValue > LIMITS.number) problems.quantity = 'Enter a smaller number.';
  else if (quantity === null) {
    problems.quantity = notANumber(form.quantity, locale, 'Enter a number above 0.');
  }

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

  // Fees are money: "1.500" in French is asked about, as in Budget and
  // Repairs (audit 4 F2-12).
  const feesValue = parseNumber(form.fees);
  const fees = feesValue ?? 0;
  if (fees > LIMITS.number) problems.fees = 'Enter a smaller number.';
  else if (!Number.isFinite(fees) || fees < 0) {
    problems.fees = notANumber(form.fees, locale, 'Enter 0 or more.');
  }

  // One setup however it's typed: "Breakout  retest" is "Breakout retest".
  const setup = form.setup.replace(/\s+/g, ' ').trim();
  if (!fits(setup, LIMITS.setup)) problems.setup = `Use ${LIMITS.setup} characters or fewer.`;
  const notes = form.notes.trim();
  if (!fits(notes, LIMITS.notes)) problems.notes = `Use ${LIMITS.notes} characters or fewer.`;

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
 * The trade form read: the trade to save and, when it's a part closed off
 * another trade, that trade too (`rest`, unchanged unless the form changed
 * it), and the trade's parts closed already that change with it (`parts`,
 * only if any do: followingParts); or what's wrong.
 */
export type ReadTrades =
  | { trade: Trade; rest: Trade | null; parts?: Trade[]; problems?: undefined }
  | { trade?: undefined; rest?: undefined; parts?: undefined; problems: CloseProblems };

/** Whether two trades are the same in every way. */
const sameTrade = (a: Trade, b: Trade): boolean =>
  (Object.keys({ ...a, ...b }) as (keyof Trade)[]).every((key) => a[key] === b[key]);

/** What a trade's parts closed already take from it when it's changed (followingParts). */
const FOLLOWED = ['entryPrice', 'side', 'setup'] as const;

/**
 * A trade's parts closed already, changed with it: its entry price, side or
 * setup put right (a typo, say) is theirs too, as they're the same trade,
 * so their results follow (audit 3 F2-10). A part whose own value was
 * different (changed on its own) keeps it. `before` is the trade as saved.
 */
function followingParts(state: TradesState, before: Trade | undefined, after: Trade): Trade[] {
  if (!before || FOLLOWED.every((key) => before[key] === after[key])) return [];
  return state.trades.flatMap((part) => {
    const take = (key: (typeof FOLLOWED)[number]) =>
      part[key] === before[key] && part[key] !== after[key];
    if (part.parent !== after.id || !FOLLOWED.some(take)) return [];
    return [
      {
        ...part,
        entryPrice: take('entryPrice') ? after.entryPrice : part.entryPrice,
        side: take('side') ? after.side : part.side,
        setup: take('setup') ? after.setup : part.setup,
      },
    ];
  });
}

/** `read`, with the parts that change with its trade, if any (followingParts). */
function withParts(
  read: { trade: Trade; rest: Trade | null },
  state: TradesState,
  before: Trade | undefined,
): ReadTrades {
  const parts = followingParts(state, before, read.rest ?? read.trade);
  return parts.length === 0 ? read : { ...read, parts };
}

/**
 * Reads the close form of a trade in `state` (`ids.id`): the trade form, and
 * how many were closed (`closeQuantity`: all that's still open, unless it's
 * changed). Numbers are read as in readTrade.
 * - Closing all of a trade without parts saves it with its exit, as
 *   readTrade does (`trade`; `rest` is null).
 * - Otherwise the part closed is a new trade (`ids.newId`) with that
 *   quantity, the exit and the fees typed in, naming the trade as its
 *   `parent` (`trade`). The trade itself (`rest`) keeps its quantity (what
 *   was bought) and its fees, with no exit. Closing what's left of a trade
 *   with parts adds its last part.
 */
export function readClose(
  form: TradeForm,
  closeQuantity: string,
  state: TradesState,
  ids: { id: string; newId: string },
  locale?: string,
): ReadTrades {
  const saved = state.trades.find((trade) => trade.id === ids.id);
  const split = partsOf(state.trades).get(ids.id) ?? NO_PARTS;
  const read = readTrade(form, ids.id, saved ? null : state.trades.length, locale);
  const problems: CloseProblems = { ...read.problems };
  const bought = readNumber(form.quantity, locale);
  const open = isPrice(bought) ? tidy(bought - split.quantity) : null;
  const closed = readNumber(closeQuantity, locale);
  if (open !== null && open <= 0) {
    problems.quantity ??= `Enter more than the ${formatNumber(split.quantity, locale)} closed already.`;
  }
  if (closed === null) problems.closeQuantity = 'Enter how many you closed.';
  else if (!isPrice(closed)) {
    problems.closeQuantity = notANumber(closeQuantity, locale, 'Enter a number above 0.');
  } else if (open !== null && open > 0 && closed > open) {
    problems.closeQuantity =
      split.quantity > 0
        ? `Enter no more than the ${formatNumber(open, locale)} still open.`
        : 'Enter no more than the trade’s quantity.';
  }
  // Less than all of it, or the rest of a trade with parts: a part.
  const part = split.quantity > 0 || (open !== null && isPrice(closed) && closed < open);
  if (part && !problems.closeQuantity) {
    if (form.exitDate.trim() === '' && form.exitPrice.trim() === '') {
      problems.exitPrice = 'Enter the exit price, to close part of the trade.';
    } else if (state.trades.length >= LIMITS.trades) {
      // The part closed is a trade of its own: one more.
      const most = `You can keep up to ${new Intl.NumberFormat(locale).format(LIMITS.trades)} trades`;
      problems.closeQuantity =
        split.quantity > 0
          ? `${most}: make room first.`
          : `${most}, so close all of it, or make room first.`;
    }
  }
  if (!read.trade || Object.keys(problems).length > 0) return { problems };
  const own = saved?.parent === undefined ? {} : { parent: saved.parent };
  if (!part) return { trade: { ...read.trade, ...own }, rest: null };
  const kept: Trade = {
    ...read.trade,
    ...own,
    exitDate: null,
    exitPrice: null,
    fees: saved?.fees ?? 0,
  };
  const rest = saved && sameTrade(kept, saved) ? saved : kept;
  return withParts(
    {
      trade: { ...read.trade, id: ids.newId, quantity: closed as number, parent: ids.id },
      rest,
    },
    state,
    saved,
  );
}

/**
 * Reads the trade form when it isn't closing: a new trade, or a change to
 * one in `state` (`ids.id`). A part keeps naming its trade. A trade with
 * parts keeps at least what they closed, and given an exit, what's still
 * open of it is closed as its last part (readClose).
 */
export function readChange(
  form: TradeForm,
  state: TradesState,
  ids: { id: string; newId: string },
  locale?: string,
): ReadTrades {
  const saved = state.trades.find((trade) => trade.id === ids.id);
  const split = (saved && partsOf(state.trades).get(saved.id)) ?? NO_PARTS;
  if (split.quantity > 0 && (form.exitDate.trim() !== '' || form.exitPrice.trim() !== '')) {
    const bought = readNumber(form.quantity, locale);
    const open = isPrice(bought) ? decimalText(tidy(bought - split.quantity), locale) : '';
    const read = readClose(form, open, state, ids, locale);
    // This form has no "Quantity closed": the quantity is what says it.
    if (!read.problems?.closeQuantity) return read;
    const { closeQuantity, ...problems } = read.problems;
    return { problems: { quantity: closeQuantity, ...problems } };
  }
  // A part closed off a trade stays closed: opened again and closed in parts
  // of its own, "Delete a year" had to choose between counting what they
  // closed as open again, here or in its trade (audit 4 F2-6). Deleting it
  // opens its quantity in its trade again. Only while that trade is there:
  // a part whose trade was deleted (with "Delete a year") is a trade of its
  // own, and can be opened again like one.
  if (
    saved?.parent !== undefined &&
    state.trades.some((trade) => trade.id === saved.parent) &&
    !isOpen(saved) &&
    form.exitDate.trim() === '' &&
    form.exitPrice.trim() === ''
  ) {
    return {
      problems: {
        exitDate:
          'This part was closed off a trade, so it stays closed. To open it again, delete it: its quantity is then open in its trade.',
      },
    };
  }
  const read = readTrade(form, ids.id, saved ? null : state.trades.length, locale);
  if (!read.trade) return { problems: read.problems };
  if (read.trade.quantity < split.quantity) {
    return {
      problems: {
        quantity: `Enter at least the ${formatNumber(split.quantity, locale)} closed already.`,
      },
    };
  }
  return withParts(
    {
      trade: saved?.parent === undefined ? read.trade : { ...read.trade, parent: saved.parent },
      rest: null,
    },
    state,
    saved,
  );
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

/** What the trade form holds: the trade's fields, and "Quantity closed" ("" unless closing). */
export interface FormValues {
  form: TradeForm;
  closeQuantity: string;
}

/**
 * The close form of an open trade: the trade form, with its fees still to
 * count (openFees) as this close's fees, and all that's still open of it as
 * the quantity closed.
 */
export function toCloseForm(
  trade: Trade,
  parts: ReadonlyMap<string, Parts>,
  locale?: string,
): FormValues {
  const fees = openFees(trade, parts);
  return {
    form: { ...toForm(trade, locale), fees: fees === 0 ? '' : decimalText(fees, locale) },
    closeQuantity: decimalText(openQuantity(trade, parts), locale),
  };
}

/**
 * Reads the trade form (readClose when `closing`, else readChange) when the
 * trade may have changed while the form was open, on another device or in
 * another tab. Only what was changed in the form goes on the trade as it is
 * now, so the other change stays (withEdits, audit 3 F2-1): a stop loss
 * moved there isn't moved back, and "Quantity closed", unless it was
 * changed, is all that's still open now. If the two don't fit together,
 * the form wins, as it was checked. `opened` is the form as it opened,
 * `edited` as it is now; a new trade, or one deleted meanwhile, is read as
 * the form is.
 */
export function readEdited(
  opened: FormValues,
  edited: FormValues,
  state: TradesState,
  ids: { id: string; newId: string },
  closing: boolean,
  locale?: string,
): ReadTrades {
  const read = ({ form, closeQuantity }: FormValues) =>
    closing
      ? readClose(form, closeQuantity, state, ids, locale)
      : readChange(form, state, ids, locale);
  const current = state.trades.find((trade) => trade.id === ids.id);
  if (!current) return read(edited);
  const now = closing
    ? toCloseForm(current, partsOf(state.trades), locale)
    : { form: toForm(current, locale), closeQuantity: '' };
  const flat = ({ form, closeQuantity }: FormValues) => ({ ...form, closeQuantity });
  const { closeQuantity, ...form } = withEdits(flat(opened), flat(edited), flat(now));
  const merged = read({ form, closeQuantity });
  return merged.trade ? merged : read(edited);
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

/**
 * Removes a trade. A part removed counts as open again in its trade (the
 * close didn't happen); a trade removed leaves its parts as trades of their own.
 */
export const removeTrade = (state: TradesState, id: string): TradesState => ({
  trades: state.trades.filter((trade) => trade.id !== id),
});

/**
 * What the page says when a trade is deleted, besides that it is: what
 * becomes of its trade, if it's a part, or of its parts. Null otherwise.
 */
export function removeNote(trade: Trade, state: TradesState, locale?: string): string | null {
  const whole = state.trades.find((entry) => entry.id === trade.parent);
  if (whole && isOpen(whole)) {
    return `The ${formatNumber(trade.quantity, locale)} it closed count as open again, in the ${whole.symbol} trade.`;
  }
  return state.trades.some((entry) => entry.parent === trade.id)
    ? 'What was closed of it stays, as trades of their own.'
    : null;
}

/**
 * Closing part of an open trade (readClose): the part closed is added, and
 * the trade it was closed off saved (as it was, unless the form changed it).
 */
export const closePart = (state: TradesState, closed: Trade, rest: Trade): TradesState =>
  saveTrade(saveTrade(state, rest), closed);

// ---------- Making room ----------

export interface YearCount {
  /** "2024". */
  year: string;
  /** How many closed trades "Delete a year" deletes. */
  count: number;
  /** How many it keeps: parts of trades still open (keptPart). */
  kept: number;
}

/** The year a trade was closed in, or null while it's open. */
const closedYear = (trade: Trade): string | null => trade.exitDate?.slice(0, 4) ?? null;

/**
 * Whether "Delete a year" keeps a trade closed in that year: part of a trade
 * still open, which needs its parts to know how much of it is (audit 3
 * F2-2). It goes with a later year, once nothing of the trade is open. And
 * part of a part, made when a part could still be opened again: its trade,
 * once emptied, would go with it, and its own trade would count it as open
 * again (audit 4 F2-6).
 */
function keptPart(
  trade: Trade,
  byId: ReadonlyMap<string, Trade>,
  parts: ReadonlyMap<string, Parts>,
): boolean {
  const whole = trade.parent === undefined ? undefined : byId.get(trade.parent);
  if (whole === undefined) return false;
  const partOfPart = whole.parent !== undefined && byId.has(whole.parent);
  return openQuantity(whole, parts) > 0 || partOfPart;
}

/**
 * The years trades were closed in (by the day they were exited, like the
 * results), the earliest first, with how many each has to delete and to
 * keep (for "Delete a year"). A year whose trades are all kept isn't one.
 */
export function closedYears(state: TradesState): YearCount[] {
  const parts = partsOf(state.trades);
  const byId = new Map(state.trades.map((trade) => [trade.id, trade]));
  const counts = new Map<string, YearCount>();
  for (const trade of state.trades) {
    const year = closedYear(trade);
    if (year === null) continue;
    const counted = counts.get(year) ?? { year, count: 0, kept: 0 };
    if (keptPart(trade, byId, parts)) counted.kept += 1;
    else counted.count += 1;
    counts.set(year, counted);
  }
  return [...counts.values()]
    .filter((counted) => counted.count > 0)
    .sort((a, b) => a.year.localeCompare(b.year));
}

/**
 * Removes the trades closed in a year ("2024"). It never changes a trade,
 * so a change to one on a device that hadn't synced can't bring back what
 * was deleted (audit 3 F2-2). Open trades stay, and so do the parts of
 * them still open (keptPart). A trade closed in parts, all of it, goes
 * with its parts of that year, as it would count them as open again; its
 * other parts stay, as trades of their own.
 */
export function removeClosedYear(state: TradesState, year: string): TradesState {
  const parts = partsOf(state.trades);
  const byId = new Map(state.trades.map((trade) => [trade.id, trade]));
  const gone = state.trades.filter(
    (trade) => closedYear(trade) === year && !keptPart(trade, byId, parts),
  );
  const ids = new Set(gone.map((trade) => trade.id));
  const emptied = new Set(gone.map((trade) => trade.parent));
  return {
    trades: state.trades.filter(
      (trade) => !ids.has(trade.id) && !(isOpen(trade) && emptied.has(trade.id)),
    ),
  };
}

/** "1 closed trade", "312 closed trades". */
export const closedCount = (count: number, locale?: string): string =>
  `${new Intl.NumberFormat(locale).format(count)} closed ${count === 1 ? 'trade' : 'trades'}`;

/**
 * What the page says once Trades is nearly full (over 90% of the trades it
 * keeps, open and closed): how many more fit, and how to make room. Null
 * until then.
 */
export const roomNote = (count: number, locale?: string): string | null =>
  sharedRoomNote({
    app: 'Trades',
    count,
    most: LIMITS.trades,
    one: 'trade',
    many: 'trades',
    also: ', open and closed',
    makeRoom:
      'To make room, download the spreadsheet, then use “Delete a year…” under Currency and spreadsheet, below.',
    locale,
  });

// ---------- Results ----------

/**
 * Rounds to 8 decimals, away the tiny errors of decimal sums (0.1 + 0.2).
 * Multiplying by 100,000,000 and rounding is exact only while the product
 * is well within a number's 53 bits (below ten million here, with room to
 * spare). Above that it left crumbs: 123,456,789,012 tokens closed in two
 * parts kept 0.00001526 "still open" for good, and "Delete a year" then kept
 * its parts for ever (audit 5 F2-1). Bigger numbers are rounded by their
 * digits instead (roundDecimal), exact at any size but twenty times slower,
 * and the results of thousands of trades are worked out at every change.
 * Never -0 either way.
 */
const tidy = (value: number): number =>
  Math.abs(value) < 1e7 ? Math.round(value * 1e8) / 1e8 || 0 : roundDecimal(value, 8);

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

/**
 * What's read out when "Results for" changes, as the results change without
 * a word otherwise (audit 4 G-9): the period, how many trades were closed in
 * it, and their net result, `money` formatting it as the tile does.
 */
export function periodSummary(
  period: Period,
  closed: readonly Trade[],
  money: (amount: number) => string,
  locale?: string,
): string {
  const { count, total } = stats(closed);
  const label = PERIOD_LABELS[period];
  return count === 0
    ? `${label}: no closed trades.`
    : `${label}: ${closedCount(count, locale)}, net result ${money(total)}.`;
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

/**
 * Open trades, the latest entered first: those with some still open, and
 * those closed more than they were bought (overClosed), to put right. A
 * trade closed in parts, all of it, isn't open.
 */
export function openTrades(state: TradesState): Trade[] {
  const parts = partsOf(state.trades);
  return state.trades
    .filter(
      (trade) => isOpen(trade) && (openQuantity(trade, parts) > 0 || overClosed(trade, parts) > 0),
    )
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate) || a.symbol.localeCompare(b.symbol));
}

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
 * Shown for a result too big to work out: a trade restored from a backup,
 * or synced, can have prices far beyond LIMITS.number (only the form checks
 * them, so data saved before can't become unreadable), and its results are
 * then infinite, or not a number at all.
 */
const NO_RESULT = '—';

/** An amount of money, like a result: "+$480.00", or "—" if it isn't finite. */
export const formatResult = (amount: number, currency: string, options?: MoneyOptions): string =>
  Number.isFinite(amount) ? formatMoney(amount, currency, options) : NO_RESULT;

/** A count of trades: "1,234". */
export const formatCount = (count: number, locale?: string): string =>
  new Intl.NumberFormat(locale).format(count);

/** The profit factor: "1.50", or "—" if it isn't finite. */
export const formatFactor = (value: number, locale?: string): string =>
  Number.isFinite(value)
    ? new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
        value,
      )
    : NO_RESULT;

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

/** "+3.2%", "-1.05%"; "—" if it isn't finite. */
export const formatPercent = (value: number, locale?: string): string =>
  Number.isFinite(value)
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2, signDisplay: 'exceptZero' }).format(
        value,
      ) + '%'
    : NO_RESULT;

/** "+2.0R", "-1.0R"; "0.0R" for what rounds to 0 (never "-0.0R"); "—" if it isn't finite. */
export const formatR = (value: number, locale?: string): string =>
  Number.isFinite(value)
    ? new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
        signDisplay: 'exceptZero',
      }).format(value) + 'R'
    : NO_RESULT;

// "October 2026", as in the other apps.
export { monthLabel } from '@shkriuss/ui/locale';

/** "Oct 19, 2026"-style dates. */
export function dateLabel(date: IsoDate, locale = DATE_LOCALE): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    Date.UTC(year, month - 1, day),
  );
}

// ---------- Spreadsheet ----------

/**
 * The trades as a CSV file (one row each, the latest entered first), as a
 * spreadsheet in the language of `locale` (the browser's own when left out)
 * reads it (csvFile). A trade closed in parts has a row for each part, and
 * one for what's still open of it, if anything is.
 */
export function toCsv(state: TradesState, locale?: string): string {
  const parts = partsOf(state.trades);
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
  const rows = state.trades
    .filter((trade) => !isOpen(trade) || openQuantity(trade, parts) > 0)
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate))
    .map((trade) => [
      trade.symbol,
      SIDE_LABELS[trade.side],
      trade.entryDate,
      trade.entryPrice,
      isOpen(trade) ? openQuantity(trade, parts) : trade.quantity,
      trade.stop,
      trade.exitDate,
      trade.exitPrice,
      isOpen(trade) ? openFees(trade, parts) : trade.fees,
      profit(trade),
      returnPercent(trade),
      rMultiple(trade),
      trade.setup,
      trade.notes,
    ]);
  return csvFile([header, ...rows], locale);
}

// ---------- Settings ----------

export interface Setting {
  id: 'currency';
  currency: Currency;
}

export type SettingsState = SavedSettings<Setting>;

const isSetting = (value: unknown): value is Setting =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<string, unknown>)['id'] === 'currency' &&
  CURRENCIES.includes((value as Record<string, unknown>)['currency'] as Currency);

/** Trades' settings, saved only once changed (@shkriuss/storage/settings). */
const SETTINGS = defineSettings<Setting>(['currency'], isSetting);

export const emptySettings = SETTINGS.empty;
export const isSettingsState = SETTINGS.isState;
/** Settings from sync: the ones that look right, once each. */
export const withSettings = SETTINGS.fromItems;

export const currencyOf = (state: SettingsState): Currency =>
  SETTINGS.get(state, 'currency')?.currency ?? 'USD';

export const setCurrency = (state: SettingsState, currency: Currency): SettingsState =>
  SETTINGS.set(state, { id: 'currency', currency });
