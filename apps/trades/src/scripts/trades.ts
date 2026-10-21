/**
 * Trades' page behaviour: connects pages/index.astro to the rules in
 * lib/trades.ts, saves on the device, and syncs the trades and the currency
 * when sync is on.
 */
import { today } from '@shkriuss/dates';
import { createStore, downloadFile } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { site } from 'virtual:shkriuss/site';
import {
  byMonth,
  bySetup,
  closedIn,
  closedTrades,
  CURRENCIES,
  currencyOf,
  dateLabel,
  emptySettings,
  emptyTrades,
  formatMoney,
  formatNumber,
  formatPercent,
  formatR,
  isSettingsState,
  isTradesState,
  matchesSearch,
  monthLabel,
  openTrades,
  PERIODS,
  profit,
  readTrade,
  removeTrade,
  returnPercent,
  rMultiple,
  saveTrade,
  setCurrency,
  setupNames,
  SIDE_LABELS,
  stats,
  toCsv,
  toForm,
  withSettings,
  type Group,
  type Period,
  type Problems,
  type SettingsState,
  type Trade,
  type TradeForm,
  type TradesState,
} from '../lib/trades.ts';

const tradesStore = createStore<TradesState>({
  key: 'trades',
  version: 1,
  fallback: emptyTrades,
  validate: isTradesState,
});

const settingsStore = createStore<SettingsState>({
  key: 'trades-settings',
  version: 1,
  fallback: emptySettings,
  validate: isSettingsState,
});

/** Closed trades shown at first, and added by "Show more". */
const PAGE_SIZE = 50;
const COULD_NOT_SAVE = 'Couldn’t save. Your browser may be blocking storage.';
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
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Trades: missing element ${selector}`);
  return element;
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

  let state = tradesStore.load();
  let settings = settingsStore.load();
  let period: Period = 'all';
  let query = '';
  let shown = PAGE_SIZE;
  /** The trade in the form (null: a new one). */
  let editing: string | null = null;

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
    announce(ok ? message : COULD_NOT_SAVE);
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
    tile('win-rate', found.winRate === null ? '—' : percent.format(found.winRate));
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
    required<HTMLElement>(item, '[data-setup]').textContent = trade.setup
      ? `Setup: ${trade.setup}`
      : '';
    const meta = required<HTMLElement>(item, '[data-meta]');
    const result = profit(trade);
    if (result === null) {
      meta.textContent = `${formatNumber(trade.quantity)} at ${formatNumber(trade.entryPrice)}, since ${dateLabel(trade.entryDate)}`;
      required<HTMLElement>(item, '[data-result]').remove();
      required<HTMLElement>(item, '[data-action="close"]').setAttribute(
        'aria-label',
        `Close the ${trade.symbol} trade`,
      );
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
          `${group.count} ${group.count === 1 ? 'trade' : 'trades'}, ${percent.format(group.wins / group.count)} won`;
        return item;
      }),
    );
  }

  function render(): void {
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

  const field = (name: keyof TradeForm) =>
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
  function showProblems(problems: Problems): boolean {
    for (const name of FIELDS) {
      const problem = problems[name];
      required<HTMLElement>(form, `[data-error-for="${name}"]`).textContent = problem ?? '';
      const control = field(name);
      const inputs = control instanceof RadioNodeList ? [...control] : [control];
      for (const input of inputs as HTMLElement[]) {
        if (problem) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
    }
    const first = FIELDS.find((name) => problems[name]);
    if (first) {
      const control = field(first);
      (
        (control instanceof RadioNodeList ? control[0] : control) as HTMLElement | undefined
      )?.focus();
    }
    return first !== undefined;
  }

  function openForm(trade: Trade | undefined, closing = false): void {
    editing = trade?.id ?? null;
    dialogTitle.textContent = !trade ? 'New trade' : closing ? 'Close trade' : 'Change trade';
    deleteButton.hidden = !trade;
    fillForm(
      trade
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

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const others = state.trades.length - (editing ? 1 : 0);
    const read = readTrade(readForm(), editing ?? crypto.randomUUID(), others);
    if (!read.trade) {
      showProblems(read.problems);
      return;
    }
    const { trade } = read;
    dialog.close();
    const result = profit(trade);
    save(
      { trades: saveTrade(state, trade) },
      result === null
        ? `Saved the ${trade.symbol} trade, still open.`
        : `Saved the ${trade.symbol} trade: ${money(result, true)}.`,
    );
    focusTrade(trade.id);
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
      deleteDialog.returnValue = '';
      deleteDialog.showModal();
    }
  });

  dialog.addEventListener('close', () => {
    editing = null;
  });

  deleteDialog.addEventListener('close', () => {
    const trade = find(editing);
    if (deleteDialog.returnValue !== 'confirm' || !trade) return;
    dialog.close();
    save({ trades: removeTrade(state, trade.id) }, `Deleted the ${trade.symbol} trade.`);
    newButton.focus();
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
    if (action === 'csv') {
      if (state.trades.length === 0) {
        announce('There are no trades to download yet.');
        return;
      }
      downloadFile(`trades-${today()}.csv`, toCsv(state), 'text/csv');
      announce('Downloaded your trades as a spreadsheet.');
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
    // The trade being changed was deleted on another device or tab.
    if (editing !== null && !find(editing)) dialog.close();
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
