import { describe, expect, it } from 'vitest';
import { addDays } from '@shkriuss/dates';
import { footprint, sampleText } from '@shkriuss/sync/testing';
import { MAX_SEALED_CHARS } from '../../../../packages/sync/src/validate.ts';
import {
  byMonth,
  bySetup,
  closedCount,
  closedIn,
  closedTrades,
  closedYears,
  closePart,
  currencyOf,
  dateLabel,
  emptySettings,
  emptyTrades,
  formatMoney,
  formatNumber,
  formatPercent,
  formatR,
  isTradesState,
  LIMITS,
  matchesSearch,
  monthLabel,
  openTrades,
  profit,
  readClose,
  readTrade,
  removeClosedYear,
  removeTrade,
  returnPercent,
  rMultiple,
  roomNote,
  saveTrade,
  setCurrency,
  setupNames,
  shownRate,
  stats,
  toCsv,
  toForm,
  withSettings,
  type Trade,
  type TradeForm,
  type TradesState,
} from './trades.ts';

const TODAY = '2026-10-21';
const trade = (overrides: Partial<Trade>): Trade => ({
  id: 't',
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
const state = (...trades: Trade[]): TradesState => ({ trades });

const form: TradeForm = {
  symbol: ' aapl ',
  side: 'long',
  entryDate: '2026-10-01',
  entryPrice: '150.25',
  quantity: '100',
  stop: '145',
  exitDate: '',
  exitPrice: '',
  fees: '',
  setup: ' Breakout ',
  notes: ' Clean break of the range. ',
};

describe('reading the form', () => {
  it('reads an open trade', () => {
    expect(readTrade(form, 'a', 0)).toEqual({
      trade: {
        id: 'a',
        symbol: 'AAPL',
        side: 'long',
        entryDate: '2026-10-01',
        entryPrice: 150.25,
        quantity: 100,
        stop: 145,
        exitDate: null,
        exitPrice: null,
        fees: 0,
        setup: 'Breakout',
        notes: 'Clean break of the range.',
      },
    });
  });

  it('reads a closed one, and back again', () => {
    const closed = readTrade(
      { ...form, exitDate: '2026-10-03', exitPrice: '155', fees: '2.5' },
      'a',
      0,
    );
    expect(closed.trade).toMatchObject({ exitDate: '2026-10-03', exitPrice: 155, fees: 2.5 });
    // A comma before the decimals reads the same ("2,5" isn't 25).
    const comma = readTrade(
      { ...form, exitDate: '2026-10-03', exitPrice: '155', fees: '2,5' },
      'a',
      0,
    );
    expect(comma.trade?.fees).toBe(2.5);
    expect(toForm(closed.trade as Trade, 'en-US')).toEqual({
      ...form,
      symbol: 'AAPL',
      setup: 'Breakout',
      notes: 'Clean break of the range.',
      exitDate: '2026-10-03',
      exitPrice: '155',
      fees: '2.5',
    });
  });

  // Audit F2-1: an entry price of "1,234" was saved as 1.234.
  it('reads numbers the way the person’s language writes them', () => {
    const price = (text: string, locale: string) =>
      readTrade({ ...form, entryPrice: text, stop: '' }, 'a', 0, locale).trade?.entryPrice;
    expect(price('1,234', 'en-US')).toBe(1234);
    expect(price('1,234.5', 'en-US')).toBe(1234.5);
    expect(price('1.234', 'de-DE')).toBe(1234);
    expect(price('1,234', 'de-DE')).toBe(1.234);
    // A price with three decimals, shown in the form in German and saved unchanged.
    const forex = trade({ symbol: 'EURUSD', entryPrice: 1.085, exitPrice: 1.092, stop: 1.081 });
    expect(toForm(forex, 'de-DE')).toMatchObject({ entryPrice: '1,085', exitPrice: '1,092' });
    expect(readTrade(toForm(forex, 'de-DE'), 't', 0, 'de-DE').trade).toEqual(forex);
  });

  // Audit F2-5: the form showed "1.5e-9", which it couldn't read back.
  it('shows tiny and huge numbers in full, and saves them unchanged', () => {
    const tiny = trade({
      symbol: 'BABYDOGE',
      entryPrice: 1.5e-9,
      stop: 1.2e-9,
      quantity: 1e12,
      exitDate: null,
      exitPrice: null,
    });
    const shown = toForm(tiny, 'en-US');
    expect(shown).toMatchObject({
      entryPrice: '0.0000000015',
      stop: '0.0000000012',
      quantity: '1000000000000',
    });
    expect(readTrade(shown, 't', 0, 'en-US').trade).toEqual(tiny);
    // Closed as "Close" fills in the form: all of it, unless less is typed.
    const exit = { ...shown, exitDate: '2026-10-05', exitPrice: '0.000000002' };
    expect(readClose(exit, shown.quantity, { id: 't', newId: 'n' }, 0, 'en-US').trade).toEqual({
      ...tiny,
      exitDate: '2026-10-05',
      exitPrice: 2e-9,
    });
    // 50 satoshis of bitcoin.
    const satoshis = trade({ symbol: 'BTCUSD', entryPrice: 60_000, quantity: 5e-7 });
    expect(toForm(satoshis, 'de-DE').quantity).toBe('0,0000005');
    expect(readTrade(toForm(satoshis, 'de-DE'), 't', 0, 'de-DE').trade).toEqual(satoshis);
  });

  it('says what’s missing or wrong', () => {
    const empty: TradeForm = {
      symbol: '',
      side: '',
      entryDate: '',
      entryPrice: '',
      quantity: '',
      stop: '',
      exitDate: '',
      exitPrice: '',
      fees: '',
      setup: '',
      notes: '',
    };
    expect(readTrade(empty, 'a', 0).problems).toEqual({
      symbol: 'Enter the symbol, like AAPL.',
      side: 'Choose long or short.',
      entryDate: 'Choose the day you entered.',
      entryPrice: 'Enter the entry price.',
      quantity: 'Enter how many.',
    });
    expect(
      readTrade({ ...form, entryPrice: '0', quantity: '-1', fees: '-2' }, 'a', 0).problems,
    ).toEqual({
      entryPrice: 'Enter a number above 0.',
      quantity: 'Enter a number above 0.',
      fees: 'Enter 0 or more.',
    });
    expect(readTrade({ ...form, stop: '151' }, 'a', 0).problems).toEqual({
      stop: 'For a long trade, the stop loss is below the entry price.',
    });
    expect(readTrade({ ...form, side: 'short' }, 'a', 0).problems).toEqual({
      stop: 'For a short trade, the stop loss is above the entry price.',
    });
    expect(readTrade({ ...form, exitPrice: '155' }, 'a', 0).problems).toEqual({
      exitDate: 'Choose the day you exited, or leave both empty.',
    });
    expect(readTrade({ ...form, exitDate: '2026-10-03' }, 'a', 0).problems).toEqual({
      exitPrice: 'Enter the exit price, or leave both empty.',
    });
    expect(
      readTrade({ ...form, exitDate: '2026-09-30', exitPrice: '155' }, 'a', 0).problems,
    ).toEqual({ exitDate: 'The exit can’t be before the entry.' });
    expect(readTrade({ ...form, symbol: 'X'.repeat(LIMITS.symbol + 1) }, 'a', 0).problems).toEqual({
      symbol: `Use ${LIMITS.symbol} characters or fewer.`,
    });
    expect(readTrade(form, 'a', LIMITS.trades).problems).toEqual({
      symbol: `You can keep up to ${new Intl.NumberFormat().format(LIMITS.trades)} trades. To make room, delete a year (under Currency and spreadsheet).`,
    });
  });

  it('checks saved trades', () => {
    expect(isTradesState(state(trade({})))).toBe(true);
    expect(isTradesState(state(trade({ exitDate: null, exitPrice: null })))).toBe(true);
    expect(isTradesState(state(trade({ exitPrice: null })))).toBe(false);
    expect(isTradesState(state(trade({ quantity: 0 })))).toBe(false);
    expect(isTradesState({ trades: {} })).toBe(false);
  });
});

describe('changing', () => {
  it('adds, replaces and removes trades', () => {
    let current = saveTrade(emptyTrades(), trade({ id: 'a' }));
    current = saveTrade(current, trade({ id: 'b', symbol: 'MSFT' }));
    current = saveTrade(current, trade({ id: 'a', symbol: 'TSLA' }));
    expect(current.trades.map((entry) => `${entry.id}:${entry.symbol}`)).toEqual([
      'a:TSLA',
      'b:MSFT',
    ]);
    expect(removeTrade(current, 'a').trades.map((entry) => entry.id)).toEqual(['b']);
  });
});

describe('closing part of a trade', () => {
  const open = trade({
    id: 'a',
    quantity: 100,
    stop: 95,
    fees: 1,
    exitDate: null,
    exitPrice: null,
  });
  const closeForm: TradeForm = {
    ...toForm(open),
    exitDate: '2026-10-05',
    exitPrice: '110',
    fees: '2',
  };
  const ids = { id: 'a', newId: 'b' };

  it('closes all of it, as saving the form does', () => {
    expect(readClose(closeForm, '100', ids, 0)).toEqual({
      trade: { ...open, exitDate: '2026-10-05', exitPrice: 110, fees: 2 },
      rest: null,
    });
  });

  it('splits it: the part closed is a new trade, and the rest stays open', () => {
    const read = readClose(closeForm, '40', ids, 0);
    // The fees typed in are the closed part's; both keep the stop loss.
    expect(read.trade).toEqual({
      ...open,
      id: 'b',
      quantity: 40,
      exitDate: '2026-10-05',
      exitPrice: 110,
      fees: 2,
    });
    expect(read.rest).toEqual({ ...open, quantity: 60, fees: 0 });
    expect(profit(read.trade as Trade)).toBe(398);
    expect(rMultiple(read.trade as Trade)).toBe(1.99);

    const before = state(trade({ id: 'x' }), open);
    const after = closePart(before, read.trade as Trade, read.rest as Trade);
    expect(after.trades.map((entry) => `${entry.id}:${entry.quantity}`)).toEqual([
      'x:10',
      'a:60',
      'b:40',
    ]);
    expect(openTrades(after).map((entry) => entry.id)).toEqual(['a']);
    // Without tiny decimal errors.
    expect(readClose({ ...closeForm, quantity: '0.3' }, '0,1', ids, 0).rest?.quantity).toBe(0.2);
  });

  it('says what’s wrong', () => {
    expect(readClose(closeForm, '', ids, 0).problems).toEqual({
      closeQuantity: 'Enter how many you closed.',
    });
    expect(readClose(closeForm, '0', ids, 0).problems).toEqual({
      closeQuantity: 'Enter a number above 0.',
    });
    expect(readClose(closeForm, '101', ids, 0).problems).toEqual({
      closeQuantity: 'Enter no more than the trade’s quantity.',
    });
    // Part of it closes only with an exit.
    expect(readClose({ ...closeForm, exitDate: '', exitPrice: '' }, '40', ids, 0).problems).toEqual(
      { exitPrice: 'Enter the exit price, to close part of the trade.' },
    );
    // The trade form's own problems too.
    expect(readClose({ ...closeForm, exitPrice: '' }, '40', ids, 0).problems).toEqual({
      exitPrice: 'Enter the exit price, or leave both empty.',
    });
    // Splitting makes one more trade: there must be room for it.
    expect(readClose(closeForm, '40', ids, LIMITS.trades - 1).problems).toEqual({
      closeQuantity: `You can keep up to ${new Intl.NumberFormat().format(LIMITS.trades)} trades, so close all of it, or make room first.`,
    });
    expect(readClose(closeForm, '100', ids, LIMITS.trades - 1).trade).toBeDefined();
  });
});

describe('making room', () => {
  const trades = state(
    trade({ id: 'a', exitDate: '2024-03-02' }),
    trade({ id: 'b', entryDate: '2024-12-30', exitDate: '2025-01-02' }),
    trade({ id: 'c', entryDate: '2023-05-01', exitDate: null, exitPrice: null }),
    trade({ id: 'd', exitDate: '2024-11-30' }),
  );

  it('lists the years trades were closed in, and deletes one (open trades stay)', () => {
    expect(closedYears(trades)).toEqual([
      { year: '2024', count: 2 },
      { year: '2025', count: 1 },
    ]);
    expect(removeClosedYear(trades, '2024').trades.map((entry) => entry.id)).toEqual(['b', 'c']);
    // By the day it was closed, not entered.
    expect(removeClosedYear(trades, '2025').trades.map((entry) => entry.id)).toEqual([
      'a',
      'c',
      'd',
    ]);
    expect(removeClosedYear(trades, '2023')).toEqual(trades);
    expect(closedCount(1, 'en-US')).toBe('1 closed trade');
    expect(closedCount(1234, 'en-US')).toBe('1,234 closed trades');
  });

  it('says so once Trades is nearly full', () => {
    const number = (value: number) => new Intl.NumberFormat('en-US').format(value);
    const nearly = LIMITS.trades * 0.9;
    const makeRoom =
      'To make room, download the spreadsheet, then use “Delete a year…” under Currency and spreadsheet, below.';
    expect(roomNote(nearly, 'en-US')).toBeNull();
    expect(roomNote(nearly + 1, 'en-US')).toBe(
      `Trades is nearly full: there’s room for ${number(LIMITS.trades - nearly - 1)} more trades (it keeps up to ${number(LIMITS.trades)}, open and closed). ${makeRoom}`,
    );
    expect(roomNote(LIMITS.trades - 1, 'en-US')).toContain('there’s room for 1 more trade (');
    expect(roomNote(LIMITS.trades, 'en-US')).toBe(
      `Trades is full: it keeps up to ${number(LIMITS.trades)} trades, open and closed. ${makeRoom}`,
    );
  });

  // Every trade is saved on the device (in localStorage, about 5 MB for each
  // site), and with sync on, also goes into the copy that goes online.
  it('has room for every trade, on the device and in the sync copy', async () => {
    const list = Array.from({ length: LIMITS.trades }, (_, index): Trade => {
      const entryDate = addDays('2016-01-01', index % 3650);
      const open = index % 20 === 0;
      return {
        id: crypto.randomUUID(),
        symbol: ['EURUSD', 'AAPL', 'BTCUSD', 'NVDA'][index % 4] ?? 'AAPL',
        side: index % 3 === 0 ? 'short' : 'long',
        entryDate,
        entryPrice: 100 + ((index * 7919) % 1_000_000) / 10_000,
        quantity: 1 + (index % 1000) * 25,
        stop: 99 + ((index * 104_729) % 1_000_000) / 10_000,
        exitDate: open ? null : addDays(entryDate, index % 30),
        exitPrice: open ? null : 101 + ((index * 1_299_709) % 1_000_000) / 10_000,
        fees: ((index * 31) % 1000) / 100,
        setup: ['Breakout retest', 'Pullback', 'Gap and go', 'Range fade'][index % 4] ?? '',
        // Long-ish notes: two or three sentences (200 of the 1,000 characters allowed).
        notes: sampleText(200, index),
      };
    });
    const size = await footprint({
      app: 'trades',
      store: 'shkriuss:trades',
      version: 1,
      data: { trades: list },
      items: list,
      // A quarter of them deleted ("Delete a year") less than 180 days ago.
      deleted: LIMITS.trades / 4,
    });
    expect(size.saved).toBeLessThan(2_000_000);
    expect(size.compressed).toBeLessThan(1_000_000);
    expect(size.sealed).toBeLessThan(MAX_SEALED_CHARS);
    // Safari allows 5 MiB (5,242,880 bytes), and counts 2 bytes for each
    // character of text with any character beyond Latin-1 (like ’ from an
    // iPhone's keyboard, or Georgian). Sync's own records are plain letters
    // and digits: 1 byte each. Some room is left for the rest.
    expect(2 * size.saved + size.syncState).toBeLessThan(4_500_000);
  }, 60_000);
});

describe('results', () => {
  it('works out profit or loss after fees, long and short', () => {
    expect(profit(trade({ fees: 2 }))).toBe(98);
    expect(profit(trade({ side: 'short' }))).toBe(-100);
    expect(profit(trade({ side: 'short', exitPrice: 90, fees: 1 }))).toBe(99);
    expect(profit(trade({ exitDate: null, exitPrice: null }))).toBeNull();
    // No tiny decimal errors.
    expect(profit(trade({ entryPrice: 0.1, exitPrice: 0.3, quantity: 3 }))).toBe(0.6);
  });

  it('as a percentage, and in R', () => {
    expect(returnPercent(trade({ fees: 2 }))).toBe(9.8);
    expect(rMultiple(trade({ stop: 95 }))).toBe(2);
    expect(rMultiple(trade({ stop: 95, exitPrice: 97.5 }))).toBe(-0.5);
    expect(rMultiple(trade({}))).toBeNull();
  });

  const trades = state(
    trade({ id: 'a', exitPrice: 120, stop: 95, setup: 'Breakout', exitDate: '2026-10-05' }),
    trade({ id: 'b', exitPrice: 95, stop: 95, setup: 'Breakout', exitDate: '2026-10-10' }),
    trade({ id: 'c', exitPrice: 130, setup: 'Pullback', exitDate: '2026-09-20' }),
    trade({ id: 'd', exitPrice: 90, exitDate: '2025-12-30' }),
    trade({ id: 'e', exitDate: null, exitPrice: null }),
  );

  it('picks the closed trades in a period', () => {
    const ids = (list: Trade[]) => list.map((entry) => entry.id).sort();
    expect(ids(closedIn(trades, 'all', TODAY))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(closedIn(trades, 'this-month', TODAY))).toEqual(['a', 'b']);
    expect(ids(closedIn(trades, 'last-month', TODAY))).toEqual(['c']);
    expect(ids(closedIn(trades, 'this-year', TODAY))).toEqual(['a', 'b', 'c']);
    expect(ids(closedIn(trades, 'last-month', '2026-01-15'))).toEqual(['d']);
  });

  it('adds up wins and losses', () => {
    const result = stats(closedIn(trades, 'all', TODAY));
    expect(result).toMatchObject({
      count: 4,
      wins: 2,
      losses: 2,
      winRate: 0.5,
      total: 350,
      averageWin: 250,
      averageLoss: -75,
      profitFactor: expect.closeTo(500 / 150, 6),
      averageR: 1.5,
    });
    expect(result.best?.id).toBe('c');
    expect(result.worst?.id).toBe('d');
    expect(stats([])).toMatchObject({
      count: 0,
      winRate: null,
      total: 0,
      averageWin: null,
      profitFactor: null,
      best: null,
      averageR: null,
    });
    expect(stats([trade({})]).profitFactor).toBeNull();
  });

  it('by setup and by month', () => {
    const closed = closedIn(trades, 'all', TODAY);
    expect(bySetup(closed)).toEqual([
      { key: 'Pullback', count: 1, wins: 1, total: 300 },
      { key: 'Breakout', count: 2, wins: 1, total: 150 },
      { key: '', count: 1, wins: 0, total: -100 },
    ]);
    expect(byMonth(closed)).toEqual([
      { key: '2026-10', count: 2, wins: 1, total: 150 },
      { key: '2026-09', count: 1, wins: 1, total: 300 },
      { key: '2025-12', count: 1, wins: 0, total: -100 },
    ]);
  });

  it('lists open and closed trades, latest first', () => {
    expect(openTrades(trades).map((entry) => entry.id)).toEqual(['e']);
    expect(closedTrades(trades.trades).map((entry) => entry.id)).toEqual(['b', 'a', 'c', 'd']);
  });
});

describe('finding', () => {
  it('searches symbols, setups and notes', () => {
    const entry = trade({ symbol: 'EURUSD', setup: 'Breakout', notes: 'Entered too early' });
    expect(matchesSearch(entry, 'eurusd')).toBe(true);
    expect(matchesSearch(entry, 'breakout early')).toBe(true);
    expect(matchesSearch(entry, 'late')).toBe(false);
    expect(matchesSearch(entry, '  ')).toBe(true);
  });

  it('suggests the setups used so far', () => {
    expect(
      setupNames(
        state(
          trade({ setup: 'Pullback' }),
          trade({ setup: 'Breakout' }),
          trade({ setup: 'Pullback' }),
          trade({}),
        ),
      ),
    ).toEqual(['Breakout', 'Pullback']);
  });
});

describe('words and numbers', () => {
  it('formats money, prices, percentages and R', () => {
    expect(formatMoney(1234.5, 'USD', { locale: 'en-US' })).toBe('$1,234.50');
    expect(formatMoney(480, 'USD', { signed: true, locale: 'en-US' })).toBe('+$480.00');
    expect(formatMoney(-120, 'EUR', { signed: true, locale: 'en-US' })).toBe('-€120.00');
    expect(formatMoney(0, 'USD', { signed: true, locale: 'en-US' })).toBe('$0.00');
    expect(formatMoney(1500, 'JPY', { locale: 'en-US' })).toBe('¥1,500');
    expect(formatNumber(1.08523, 'en-US')).toBe('1.08523');
    expect(formatNumber(0.00001234, 'en-US')).toBe('0.00001234');
    // Tiny prices (some tokens) keep their digits, not "0".
    expect(formatNumber(1.234e-9, 'en-US')).toBe('0.000000001234');
    expect(formatNumber(1_000_000_000_000, 'en-US')).toBe('1,000,000,000,000');
    expect(formatPercent(3.2, 'en-US')).toBe('+3.2%');
    expect(formatPercent(-1.05, 'en-US')).toBe('-1.05%');
    expect(formatR(2)).toBe('+2.0R');
    expect(formatR(-0.5)).toBe('-0.5R');
    expect(monthLabel('2026-10', 'en-US')).toBe('October 2026');
    expect(dateLabel('2026-10-19', 'en-US')).toBe('Oct 19, 2026');
  });
});

describe('number sizes', () => {
  it('refuses numbers too big to work with', () => {
    const big = '2000000000000';
    expect(readTrade({ ...form, entryPrice: big }, 'a', 0).problems?.entryPrice).toBe(
      'Enter a smaller number.',
    );
    expect(readTrade({ ...form, quantity: big }, 'a', 0).problems?.quantity).toBe(
      'Enter a smaller number.',
    );
    expect(readTrade({ ...form, fees: big }, 'a', 0).problems?.fees).toBe(
      'Enter a smaller number.',
    );
    expect(readTrade({ ...form, quantity: '1000000000000' }, 'a', 0).trade?.quantity).toBe(1e12);
  });
});

describe('win rates as shown', () => {
  it('are whole percent, never 100% with a loss or 0% with a win', () => {
    expect(shownRate(0.5)).toEqual({ value: 0.5, digits: 0 });
    expect(shownRate(1)).toEqual({ value: 1, digits: 0 });
    expect(shownRate(0)).toEqual({ value: 0, digits: 0 });
    expect(shownRate(249 / 250)).toEqual({ value: 0.996, digits: 1 });
    expect(shownRate(9999 / 10000)).toEqual({ value: 0.999, digits: 1 });
    expect(shownRate(1 / 400)).toEqual({ value: 0.003, digits: 1 });
  });
});

describe('setups', () => {
  it('are one setup however they’re capitalised or spaced', () => {
    const trades = [
      trade({ id: 'a', setup: 'Breakout', exitPrice: 110 }),
      trade({ id: 'b', setup: 'breakout', exitPrice: 90 }),
      trade({ id: 'c', setup: 'Breakout  retest', exitPrice: 110 }),
      trade({ id: 'd', setup: 'Breakout retest', exitPrice: 110 }),
    ];
    expect(bySetup(trades).map((group) => [group.key, group.count])).toEqual([
      ['Breakout retest', 2],
      ['Breakout', 2],
    ]);
    expect(setupNames(state(...trades))).toEqual(['Breakout', 'Breakout retest']);
    expect(readTrade({ ...form, setup: '  Breakout   retest ' }, 'a', 0).trade?.setup).toBe(
      'Breakout retest',
    );
  });

  // Audit F2-2: a Thai tone mark was dropped like an accent.
  it('are told apart when they differ in a tone mark or vowel sign', () => {
    const trades = [
      trade({ id: 'a', setup: 'ข้าว' }),
      trade({ id: 'b', setup: 'ขาว' }),
      trade({ id: 'c', setup: 'Café' }),
      trade({ id: 'd', setup: 'cafe' }),
    ];
    expect(bySetup(trades).map((group) => [group.key, group.count])).toEqual([
      ['Café', 2],
      ['ขาว', 1],
      ['ข้าว', 1],
    ]);
    expect(matchesSearch(trade({ notes: 'ข้าว' }), 'ขาว')).toBe(false);
  });
});

describe('spreadsheet', () => {
  it('has a row for each trade, safe to open', () => {
    const csv = toCsv(
      state(
        trade({ id: 'a', stop: 95, fees: 2, setup: 'Breakout', notes: 'Good, "clean" entry' }),
        trade({
          id: 'b',
          entryDate: '2026-10-10',
          exitDate: null,
          exitPrice: null,
          notes: '=SUM(A1)',
        }),
      ),
    );
    expect(csv.split('\r\n')).toEqual([
      'Symbol,Side,Entry date,Entry price,Quantity,Stop loss,Exit date,Exit price,Fees,Net result,Return %,R,Setup,Notes',
      "AAPL,Long,2026-10-10,100,10,,,,0,,,,,'=SUM(A1)",
      'AAPL,Long,2026-10-01,100,10,95,2026-10-05,110,2,98,9.8,1.96,Breakout,"Good, ""clean"" entry"',
      '',
    ]);
  });
});

describe('settings', () => {
  it('uses dollars until another currency is chosen', () => {
    expect(currencyOf(emptySettings())).toBe('USD');
    const euros = setCurrency(emptySettings(), 'EUR');
    expect(currencyOf(euros)).toBe('EUR');
    expect(setCurrency(euros, 'GEL').settings).toEqual([{ id: 'currency', currency: 'GEL' }]);
    expect(
      withSettings([
        { id: 'currency', currency: 'BTC' },
        { id: 'currency', currency: 'GBP' },
      ]).settings,
    ).toEqual([{ id: 'currency', currency: 'GBP' }]);
  });
});
