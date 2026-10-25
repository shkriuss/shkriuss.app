/**
 * Trades' page behaviour: connects pages/index.astro to the rules in
 * lib/trades.ts, saves on the device, and syncs the trades and the currency
 * when sync is on. "Close" opens the trade form to close a trade, all of it
 * or part of it; "Delete a year…" deletes the trades closed in a year.
 */
import { today } from '@shkriuss/dates';
import { createStore, downloadFile } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { reportSave } from '@shkriuss/ui/problem';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { typedText } from '@shkriuss/ui/typed-text';
import { site } from 'virtual:shkriuss/site';
import {
  byMonth,
  bySetup,
  closedCount,
  closedIn,
  closedTrades,
  closedYears,
  closePart,
  CURRENCIES,
  currencyOf,
  dateLabel,
  emptySettings,
  emptyTrades,
  formatMoney,
  formatNumber,
  formatPercent,
  formatR,
  isOpen,
  isSettingsState,
  isTradesState,
  matchesSearch,
  migrateTrades,
  monthLabel,
  openQuantity,
  openTrades,
  overClosedNote,
  partsOf,
  PERIODS,
  profit,
  readChange,
  readClose,
  removeClosedYear,
  removeNote,
  removeTrade,
  returnPercent,
  rMultiple,
  roomNote,
  saveTrade,
  setCurrency,
  setupNames,
  shownRate,
  SIDE_LABELS,
  stats,
  toCloseForm,
  toCsv,
  toForm,
  withSettings,
  type CloseProblems,
  type Group,
  type Parts,
  type Period,
  type SettingsState,
  type Trade,
  type TradeForm,
  type TradesState,
  TRADES_VERSION,
} from '../lib/trades.ts';
import { required, showFieldProblems } from '@shkriuss/ui/dom';

// Version 2 added parts that name the trade they were closed off.
const tradesStore = createStore<TradesState>({
  key: 'trades',
  version: TRADES_VERSION,
  fallback: emptyTrades,
  validate: isTradesState,
  migrate: migrateTrades,
});

const settingsStore = createStore<SettingsState>({
  key: 'trades-settings',
  version: 1,
  fallback: emptySettings,
  validate: isSettingsState,
});

/** Closed trades shown at first, and added by "Show more". */
const PAGE_SIZE = 50;
const FIELDS: readonly (keyof TradeForm)[] = [
  'symbol',
  'side',
  'entryDate',
  'entryPrice',
  'quantity',
  'stop',
  'exitDate',
  'exitPrice',
  'fees',
  'setup',
  'notes',
];
type FieldName = keyof TradeForm | 'closeQuantity';
/** Every field, in the form's order: "Quantity closed" (only while closing) is before the fees. */
const ALL_FIELDS: readonly FieldName[] = [
  ...FIELDS.slice(0, FIELDS.indexOf('fees')),
  'closeQuantity',
  ...FIELDS.slice(FIELDS.indexOf('fees')),
];
/** A win rate: whole percent, never rounded to 100% with a loss or to 0% with a win. */
function rateText(rate: number): string {
  const { value, digits } = shownRate(rate);
  return new Intl.NumberFormat(undefined, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Green for a win, red for a loss. */
function tone(element: Element, amount: number): void {
  element.classList.toggle('win', amount > 0);
  element.classList.toggle('loss', amount < 0);
}

export function mountTrades(root: Document): void {
  const announcer = required<HTMLElement>(root, '[data-announcer]');
  const newButton = required<HTMLButtonElement>(root, '[data-action="new"]');
  const periodSelect = required<HTMLSelectElement>(root, '[data-period]');
  const noResults = required<HTMLElement>(root, '[data-no-results]');
  const tiles = required<HTMLElement>(root, '[data-tiles]');
  const openSection = required<HTMLElement>(root, '[data-open-section]');
  const openList = required<HTMLUListElement>(root, '[data-open-list]');
  const searchInput = required<HTMLInputElement>(root, '[data-search]');
  const closedEmpty = required<HTMLElement>(root, '[data-closed-empty]');
  const closedList = required<HTMLUListElement>(root, '[data-closed-list]');
  const more = required<HTMLElement>(root, '[data-more]');
  const setupsSection = required<HTMLElement>(root, '[data-setups-section]');
  const setupList = required<HTMLElement>(root, '[data-setups]');
  const monthsSection = required<HTMLElement>(root, '[data-months-section]');
  const monthList = required<HTMLElement>(root, '[data-months]');
  const currencySelect = required<HTMLSelectElement>(root, '[data-currency]');
  const setupNamesList = required<HTMLDataListElement>(root, '[data-setup-names]');
  const tradeTemplate = required<HTMLTemplateElement>(root, '[data-trade-template]');
  const groupTemplate = required<HTMLTemplateElement>(root, '[data-group-template]');
  const dialog = required<HTMLDialogElement>(root, '[data-trade-dialog]');
  const form = required<HTMLFormElement>(dialog, '[data-trade-form]');
  const dialogTitle = required<HTMLElement>(dialog, '[data-trade-title]');
  const deleteButton = required<HTMLElement>(dialog, '[data-action="delete"]');
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteName = required<HTMLElement>(deleteDialog, '[data-delete-name]');
  const deleteMore = required<HTMLElement>(deleteDialog, '[data-delete-more]');
  const closeQuantityField = required<HTMLElement>(form, '[data-close-quantity]');
  const roomText = required<HTMLElement>(root, '[data-room-note]');
  const csvStatus = required<HTMLElement>(root, '[data-csv-status]');
  const deleteYearButton = required<HTMLButtonElement>(root, '[data-action="delete-year"]');
  const yearDialog = required<HTMLDialogElement>(root, '[data-year-dialog]');
  const yearForm = required<HTMLFormElement>(yearDialog, '[data-year-form]');
  const yearSelect = required<HTMLSelectElement>(yearForm, '[data-year-select]');
  const yearText = required<HTMLElement>(yearForm, '[data-year-text]');
  const yearConfirm = required<HTMLElement>(yearForm, '[data-year-confirm]');

  let state = tradesStore.load();
  let settings = settingsStore.load();
  let period: Period = 'all';
  let query = '';
  let shown = PAGE_SIZE;
  /** The trade in the form (null: a new one). */
  let editing: string | null = null;
  /** Whether the form is closing an open trade ("Close"), so it can close part of it. */
  let closing = false;
  /** What was closed off each trade in parts, and every trade by id: worked out at each render. */
  let parts = new Map<string, Parts>();
  let byId = new Map<string, Trade>();

  const announce = (message: string): void => {
    announcer.textContent = message;
  };
  const find = (id: string | null | undefined) => state.trades.find((trade) => trade.id === id);
  const money = (amount: number, signed = false) =>
    formatMoney(amount, currencyOf(settings), { signed });

  /** Saves, shows the change, and tells other devices. */
  function save(next: { trades?: TradesState; settings?: SettingsState }, message: string): void {
    let ok = true;
    if (next.trades) {
      state = next.trades;
      ok = tradesStore.save(state) && ok;
    }
    if (next.settings) {
      settings = next.settings;
      ok = settingsStore.save(settings) && ok;
    }
    if (reportSave(ok)) announce(message);
    render();
    sync.changed();
  }

  // ---------- Results ----------

  function tile(key: string, value: string, note = '', amount?: number): void {
    const element = required<HTMLElement>(tiles, `[data-tile="${key}"]`);
    const valueText = required<HTMLElement>(element, '[data-value]');
    valueText.textContent = value;
    tone(valueText, amount ?? 0);
    required<HTMLElement>(element, '[data-note]').textContent = note;
  }

  function renderResults(closed: readonly Trade[]): void {
    const found = stats(closed);
    noResults.hidden = found.count > 0;
    tiles.hidden = found.count === 0;
    if (found.count === 0) return;
    tile('total', money(found.total, true), '', found.total);
    tile('count', String(found.count), `${found.wins} won, ${found.losses} lost`);
    tile('win-rate', found.winRate === null ? '—' : rateText(found.winRate));
    tile(
      'profit-factor',
      found.profitFactor === null ? '—' : found.profitFactor.toFixed(2),
      found.profitFactor === null ? 'No losses yet' : 'Won for each 1 lost',
    );
    tile(
      'average-win',
      found.averageWin === null ? '—' : money(found.averageWin, true),
      '',
      found.averageWin ?? 0,
    );
    tile(
      'average-loss',
      found.averageLoss === null ? '—' : money(found.averageLoss, true),
      '',
      found.averageLoss ?? 0,
    );
    for (const [key, trade] of [
      ['best', found.best],
      ['worst', found.worst],
    ] as const) {
      const result = trade ? profit(trade) : null;
      if (!trade || result === null) tile(key, '—');
      else
        tile(
          key,
          money(result, true),
          `${trade.symbol}, ${dateLabel(trade.exitDate ?? trade.entryDate)}`,
          result,
        );
    }
    tile(
      'average-r',
      found.averageR === null ? '—' : formatR(found.averageR),
      found.averageR === null ? 'Add stop losses to see this' : '',
      found.averageR ?? 0,
    );
  }

  // ---------- Lists ----------

  function renderTrade(trade: Trade): HTMLLIElement {
    const fragment = tradeTemplate.content.cloneNode(true) as DocumentFragment;
    const item = required<HTMLLIElement>(fragment, 'li');
    item.dataset['id'] = trade.id;
    required<HTMLElement>(item, '[data-symbol]').textContent = trade.symbol;
    required<HTMLElement>(item, '[data-side]').textContent = SIDE_LABELS[trade.side];
    const setup = required<HTMLElement>(item, '[data-setup]');
    setup.textContent = trade.setup ? 'Setup: ' : '';
    if (trade.setup) setup.append(typedText(trade.setup));
    const meta = required<HTMLElement>(item, '[data-meta]');
    // Closed more than bought (on two devices at once): says so, on it and its parts.
    required<HTMLElement>(item, '[data-problem]').textContent =
      overClosedNote(trade, parts, byId) ?? '';
    const result = profit(trade);
    if (result === null) {
      // What's still open of it; all it bought, if more than that was closed.
      const open = openQuantity(trade, parts);
      meta.textContent = `${formatNumber(open > 0 ? open : trade.quantity)} at ${formatNumber(trade.entryPrice)}, since ${dateLabel(trade.entryDate)}`;
      required<HTMLElement>(item, '[data-result]').remove();
      if (open > 0) {
        required<HTMLElement>(item, '[data-action="close"]').setAttribute(
          'aria-label',
          `Close the ${trade.symbol} trade`,
        );
      } else required<HTMLElement>(item, '[data-close]').remove();
    } else {
      meta.textContent = `${formatNumber(trade.quantity)} · ${formatNumber(trade.entryPrice)} → ${formatNumber(trade.exitPrice ?? 0)} · ${dateLabel(trade.exitDate ?? trade.entryDate)}`;
      const profitText = required<HTMLElement>(item, '[data-profit]');
      profitText.textContent = money(result, true);
      tone(profitText, result);
      const r = rMultiple(trade);
      required<HTMLElement>(item, '[data-extra]').textContent = [
        formatPercent(returnPercent(trade) ?? 0),
        r === null ? null : formatR(r),
      ]
        .filter(Boolean)
        .join(' · ');
      required<HTMLElement>(item, '[data-close]').remove();
    }
    return item;
  }

  function renderLists(closedInPeriod: readonly Trade[]): void {
    const open = openTrades(state);
    openSection.hidden = open.length === 0;
    openList.replaceChildren(...open.map(renderTrade));

    const closed = closedTrades(closedInPeriod).filter((trade) => matchesSearch(trade, query));
    closedList.replaceChildren(...closed.slice(0, shown).map(renderTrade));
    more.hidden = closed.length <= shown;
    closedEmpty.hidden = closed.length > 0;
    closedEmpty.textContent = query.trim()
      ? 'No closed trades match your search.'
      : closedTrades(state.trades).length === 0
        ? 'No closed trades yet.'
        : 'No closed trades in this period.';
  }

  function renderGroups(
    list: HTMLElement,
    groups: readonly Group[],
    name: (key: string) => string,
  ) {
    list.replaceChildren(
      ...groups.map((group) => {
        const fragment = groupTemplate.content.cloneNode(true) as DocumentFragment;
        const item = required<HTMLLIElement>(fragment, 'li');
        required<HTMLElement>(item, '[data-group-name]').textContent = name(group.key);
        const total = required<HTMLElement>(item, '[data-group-total]');
        total.textContent = money(group.total, true);
        tone(total, group.total);
        required<HTMLElement>(item, '[data-group-counts]').textContent =
          `${group.count} ${group.count === 1 ? 'trade' : 'trades'}, ${rateText(group.wins / group.count)} won`;
        return item;
      }),
    );
  }

  function render(): void {
    parts = partsOf(state.trades);
    byId = new Map(state.trades.map((trade) => [trade.id, trade]));
    const room = roomNote(state.trades.length);
    roomText.hidden = room === null;
    roomText.textContent = room ?? '';
    const closed = closedIn(state, period, today());
    renderResults(closed);
    renderLists(closed);
    const setups = bySetup(closed);
    setupsSection.hidden = !setups.some((group) => group.key !== '');
    renderGroups(setupList, setups, (key) => key || 'No setup');
    const months = byMonth(closed);
    monthsSection.hidden = months.length === 0;
    renderGroups(monthList, months, (key) => monthLabel(key));
    currencySelect.value = currencyOf(settings);
    setupNamesList.replaceChildren(...setupNames(state).map((name) => new Option(name)));
  }

  // ---------- The form ----------

  const field = (name: FieldName) =>
    form.elements.namedItem(name) as HTMLInputElement | RadioNodeList;

  function readForm(): TradeForm {
    const values = Object.fromEntries(
      FIELDS.map((name) => [name, (field(name) as { value: string }).value]),
    );
    return values as unknown as TradeForm;
  }

  function fillForm(values: TradeForm): void {
    for (const name of FIELDS) (field(name) as { value: string }).value = values[name];
    showProblems({});
  }

  /** Shows what's wrong; focuses the first field with a problem. Returns true if anything is. */
  const showProblems = (problems: CloseProblems): boolean =>
    showFieldProblems(form, ALL_FIELDS, problems, { focusFirst: true });

  function openForm(trade: Trade | undefined, close = false): void {
    editing = trade?.id ?? null;
    closing = close && trade !== undefined && isOpen(trade);
    dialogTitle.textContent = !trade ? 'New trade' : closing ? 'Close trade' : 'Change trade';
    deleteButton.hidden = !trade;
    // Closing: all that's still open, unless less is typed, with the fees not counted yet.
    const closeForm = closing && trade ? toCloseForm(trade, parts) : null;
    closeQuantityField.hidden = !closing;
    (field('closeQuantity') as HTMLInputElement).value = closeForm?.closeQuantity ?? '';
    fillForm(
      closeForm
        ? closeForm.form
        : trade
          ? toForm(trade)
          : {
              symbol: '',
              side: 'long',
              entryDate: today(),
              entryPrice: '',
              quantity: '',
              stop: '',
              exitDate: '',
              exitPrice: '',
              fees: '',
              setup: '',
              notes: '',
            },
    );
    dialog.showModal();
    if (closing) {
      const exitDate = field('exitDate') as HTMLInputElement;
      if (!exitDate.value) exitDate.value = today();
      (field('exitPrice') as HTMLInputElement).focus();
    }
  }

  /** After saving: focus the trade in its list, or "New trade" if it isn't shown. */
  function focusTrade(id: string): void {
    const button = root.querySelector<HTMLElement>(
      `li[data-id="${CSS.escape(id)}"] [data-action="edit"]`,
    );
    (button ?? newButton).focus();
  }

  /** Saves part of a trade closed, with the trade it was closed off, and says what's still open. */
  function saveClosedPart(part: Trade, rest: Trade): void {
    dialog.close();
    const next = closePart(state, part, rest);
    const open = openQuantity(rest, partsOf(next.trades));
    const result = money(profit(part) ?? 0, true);
    save(
      { trades: next },
      open > 0
        ? `Closed ${formatNumber(part.quantity)} of the ${part.symbol} trade: ${result}. ${formatNumber(open)} still open.`
        : `Closed the rest of the ${part.symbol} trade: ${result}.`,
    );
    focusTrade(part.id);
  }

  /** Saves the trade read from the form, and says how it stands. */
  function saveFromForm(trade: Trade): void {
    dialog.close();
    const result = profit(trade);
    save(
      { trades: saveTrade(state, trade) },
      result === null
        ? `Saved the ${trade.symbol} trade, still open.`
        : `Saved the ${trade.symbol} trade: ${money(result, true)}.`,
    );
    focusTrade(trade.id);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const ids = { id: editing ?? crypto.randomUUID(), newId: crypto.randomUUID() };
    // Closing: all of it, or part of it (the rest stays open).
    const read =
      closing && editing
        ? readClose(readForm(), (field('closeQuantity') as HTMLInputElement).value, state, ids)
        : readChange(readForm(), state, ids);
    if (!read.trade) {
      showProblems(read.problems);
      return;
    }
    if (read.rest) saveClosedPart(read.trade, read.rest);
    else saveFromForm(read.trade);
  });

  form.addEventListener('click', (event) => {
    const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset[
      'action'
    ];
    if (action === 'cancel') dialog.close();
    if (action === 'delete') {
      const trade = find(editing);
      if (!trade) return;
      deleteName.textContent = `${trade.symbol} ${SIDE_LABELS[trade.side].toLowerCase()}`;
      // A part, or a trade with parts: what becomes of the others.
      const more = removeNote(trade, state);
      deleteMore.hidden = more === null;
      deleteMore.textContent = more ?? '';
      deleteDialog.returnValue = '';
      deleteDialog.showModal();
    }
  });

  dialog.addEventListener('close', () => {
    editing = null;
    closing = false;
  });

  deleteDialog.addEventListener('close', () => {
    const trade = find(editing);
    if (deleteDialog.returnValue !== 'confirm' || !trade) return;
    dialog.close();
    save({ trades: removeTrade(state, trade.id) }, `Deleted the ${trade.symbol} trade.`);
    newButton.focus();
  });

  // ---------- Deleting a year ----------

  /** How many trades were closed in the year chosen (0 if none are now). */
  const yearCount = (year: string) =>
    closedYears(state).find((entry) => entry.year === year)?.count ?? 0;

  /** Says what deleting the year chosen removes. */
  function showYear(): void {
    const year = yearSelect.value;
    const count = closedCount(yearCount(year));
    yearText.textContent = `The ${count} from ${year} will be deleted. Open trades stay. With sync on, they’re deleted on your other devices too. This can’t be undone.`;
    yearConfirm.textContent = `Delete ${count}`;
  }

  /** The years trades were closed in, to choose from (the year chosen stays chosen while it has any). */
  function fillYears(): void {
    const chosen = yearSelect.value;
    const years = closedYears(state);
    yearSelect.replaceChildren(
      ...years.map(({ year, count }) => new Option(`${year} (${closedCount(count)})`, year)),
    );
    // Else the first, the earliest year: the oldest trades are the likeliest to go.
    if (years.some(({ year }) => year === chosen)) yearSelect.value = chosen;
    showYear();
  }

  function openYears(): void {
    if (closedYears(state).length === 0) {
      csvStatus.textContent = 'There are no closed trades to delete.';
      return;
    }
    yearSelect.replaceChildren();
    fillYears();
    required<HTMLElement>(yearForm, '[data-csv-status]').textContent = '';
    yearDialog.showModal();
    yearSelect.focus();
  }

  yearSelect.addEventListener('change', showYear);

  yearForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const year = yearSelect.value;
    const count = yearCount(year);
    yearDialog.close();
    deleteYearButton.focus();
    if (count === 0) return;
    // Like deleting trades one by one, so other devices delete them too.
    save({ trades: removeClosedYear(state, year) }, `Deleted ${closedCount(count)} from ${year}.`);
  });

  // ---------- Everything else on the page ----------

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-action]');
    const action = button?.dataset['action'];
    const trade = find(button?.closest<HTMLElement>('li[data-id]')?.dataset['id']);
    if (action === 'new') openForm(undefined);
    if (action === 'edit' && trade) openForm(trade);
    if (action === 'close' && trade) openForm(trade, true);
    if (action === 'more') {
      const first = shown;
      shown += PAGE_SIZE;
      render();
      closedList.querySelectorAll<HTMLElement>('[data-action="edit"]')[first]?.focus();
    }
    if (action === 'delete-year') openYears();
    if (action === 'cancel' && button?.closest('[data-year-dialog]')) yearDialog.close();
    if (action === 'csv') {
      // The answer shows under the button tapped (and is read out).
      const status =
        button?.closest('dialog, section')?.querySelector<HTMLElement>('[data-csv-status]') ??
        csvStatus;
      if (state.trades.length === 0) {
        status.textContent = 'There are no trades to download yet.';
        return;
      }
      downloadFile(`trades-${today()}.csv`, toCsv(state), 'text/csv');
      status.textContent = 'Downloaded your trades as a spreadsheet.';
    }
  });

  periodSelect.addEventListener('change', () => {
    period = PERIODS.find((entry) => entry === periodSelect.value) ?? 'all';
    shown = PAGE_SIZE;
    render();
  });

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    shown = PAGE_SIZE;
    render();
  });

  currencySelect.addEventListener('change', () => {
    const chosen = CURRENCIES.find((entry) => entry === currencySelect.value);
    if (!chosen || chosen === currencyOf(settings)) return;
    save({ settings: setCurrency(settings, chosen) }, `Amounts are shown in ${chosen} now.`);
  });

  // ---------- Keeping up ----------

  function reload(): void {
    state = tradesStore.load();
    settings = settingsStore.load();
    // The trade being changed was deleted on another device or tab, or the
    // one being closed was closed there.
    const trade = find(editing);
    if (editing !== null && !trade) dialog.close();
    else if (closing && trade && openQuantity(trade, partsOf(state.trades)) <= 0) dialog.close();
    if (yearDialog.open) {
      if (closedYears(state).length === 0) yearDialog.close();
      else fillYears();
    }
    render();
  }

  // "This month" moves on with the calendar.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') render();
  });

  // If Trades is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    if (event.key === tradesStore.key || event.key === settingsStore.key) reload();
  });

  // Sync between devices through the shkriuss account (if turned on). The
  // newest change to each trade wins (a trade changed on two devices at once
  // isn't kept twice: that would count it twice in the results).
  const sync = createSync({
    app: site.slug,
    stores: [
      syncedStore({
        store: tradesStore,
        items: (value) => value.trades,
        withItems: (value, trades) => ({ ...value, trades }),
      }),
      syncedStore({
        store: settingsStore,
        items: (value) => value.settings,
        withItems: (_value, items) => withSettings(items),
      }),
    ],
    onChange: reload,
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);

  render();
}
