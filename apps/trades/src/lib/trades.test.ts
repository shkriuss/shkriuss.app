import { describe, expect, it } from 'vitest';
import {
  byMonth,
  bySetup,
  closedIn,
  closedTrades,
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
  readTrade,
  removeTrade,
  returnPercent,
  rMultiple,
  saveTrade,
  setCurrency,
  setupNames,
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
    expect(toForm(closed.trade as Trade)).toEqual({
      ...form,
      symbol: 'AAPL',
      setup: 'Breakout',
      notes: 'Clean break of the range.',
      exitDate: '2026-10-03',
      exitPrice: '155',
      fees: '2.5',
    });
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
      symbol: `You can keep up to ${LIMITS.trades} trades.`,
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
    expect(formatPercent(3.2, 'en-US')).toBe('+3.2%');
    expect(formatPercent(-1.05, 'en-US')).toBe('-1.05%');
    expect(formatR(2)).toBe('+2.0R');
    expect(formatR(-0.5)).toBe('-0.5R');
    expect(monthLabel('2026-10', 'en-US')).toBe('October 2026');
    expect(dateLabel('2026-10-19', 'en-US')).toBe('Oct 19, 2026');
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
