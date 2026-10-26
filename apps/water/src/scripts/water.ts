/**
 * Water's page behaviour: connects pages/index.astro to the rules in
 * lib/water.ts, saves on the device, and syncs both lists (drinks and
 * settings) when sync is on. Reminders: reminders.ts.
 */
import {
  addDays,
  isIsoDate,
  isIsoTime,
  nowStamp,
  toStamp,
  today,
  type IsoDate,
  type IsoTime,
} from '@shkriuss/dates';
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { keepFocus } from '@shkriuss/ui/keep-focus';
import { focusProblem, reportSave } from '@shkriuss/ui/problem';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { site } from 'virtual:shkriuss/site';
import {
  addDrink,
  amountOf,
  amountProblem,
  AMOUNTS,
  averageOf,
  dayLabel,
  drinkProblem,
  drinksOn,
  emptyDrinks,
  emptySettings,
  everyLabel,
  formatAmount,
  GOAL_REACHED,
  inUnit,
  isDrinksState,
  isSettingsState,
  LIMITS,
  progressText,
  pruneDrinks,
  reachedOn,
  recentDays,
  remindersOf,
  removeDrink,
  setAmount,
  setReminders,
  setUnit,
  streak,
  streakText,
  timeLabel,
  totalOn,
  typedMl,
  UNIT_LABELS,
  unitOf,
  UNITS,
  withDrinks,
  withSettings,
  type Amount,
  type DayTotal,
  type Drink,
  type DrinksState,
  type SettingsState,
  type Unit,
  DRINKS_VERSION,
  SETTINGS_VERSION,
} from '../lib/water.ts';
import { mountReminders } from './reminders.ts';
import { DATE_LOCALE } from '@shkriuss/ui/locale';
import { required } from '@shkriuss/ui/dom';

const drinksStore = createStore<DrinksState>({
  key: 'water',
  version: DRINKS_VERSION,
  fallback: emptyDrinks,
  validate: isDrinksState,
});

const settingsStore = createStore<SettingsState>({
  key: 'water-settings',
  version: SETTINGS_VERSION,
  fallback: emptySettings,
  validate: isSettingsState,
});

/** How often to check whether the day has changed while Water is open. */
const NEW_DAY_CHECK_MS = 60 * 1000;
const AMOUNT_LABELS: Record<Amount, string> = {
  goal: 'Daily goal',
  glass: 'Glass',
  bottle: 'Bottle',
};
const UNIT_NAMES: Record<Unit, string> = { ml: 'millilitres', oz: 'US fluid ounces' };

const dateFormat = new Intl.DateTimeFormat(DATE_LOCALE, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

const dateOf = (date: IsoDate): number => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
};

function showProblem(input: HTMLElement, error: HTMLElement, problem: string | undefined): void {
  error.textContent = problem ?? '';
  if (problem) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

export function mountWater(root: Document): void {
  const announcer = required<HTMLElement>(root, '[data-announcer]');
  const dateText = required<HTMLElement>(root, '[data-date]');
  const totalText = required<HTMLElement>(root, '[data-total]');
  const goalText = required<HTMLElement>(root, '[data-goal]');
  const progress = required<HTMLProgressElement>(root, '[data-progress]');
  const leftText = required<HTMLElement>(root, '[data-left]');
  const otherButton = required<HTMLButtonElement>(root, '[data-action="other"]');
  const noDrinks = required<HTMLElement>(root, '[data-none]');
  const drinkList = required<HTMLUListElement>(root, '[data-drinks]');
  const drinkTemplate = required<HTMLTemplateElement>(root, '[data-drink-template]');
  const streakLine = required<HTMLElement>(root, '[data-streak]');
  const averageLine = required<HTMLElement>(root, '[data-average]');
  const dayList = required<HTMLUListElement>(root, '[data-days]');
  const dayTemplate = required<HTMLTemplateElement>(root, '[data-day-template]');

  const settingsForm = required<HTMLFormElement>(root, '[data-settings-form]');
  const unitRadios = [...settingsForm.querySelectorAll<HTMLInputElement>('input[name="unit"]')];
  const amountInput = (amount: Amount) =>
    required<HTMLInputElement>(settingsForm, `[data-amount="${amount}"]`);
  const amountError = (amount: Amount) =>
    required<HTMLElement>(settingsForm, `[data-error-for="${amount}"]`);

  const remindersOn = required<HTMLInputElement>(root, '[data-reminders-on]');
  const reminderEvery = required<HTMLSelectElement>(root, '[data-reminder="every"]');
  const reminderFrom = required<HTMLInputElement>(root, '[data-reminder="from"]');
  const reminderUntil = required<HTMLInputElement>(root, '[data-reminder="until"]');
  const reminderError = required<HTMLElement>(root, '[data-reminder-error]');

  const otherDialog = required<HTMLDialogElement>(root, '[data-other-dialog]');
  const otherForm = required<HTMLFormElement>(otherDialog, '[data-other-form]');
  const otherAmount = required<HTMLInputElement>(otherForm, 'input[name="amount"]');
  const otherDay = required<HTMLSelectElement>(otherForm, 'select[name="day"]');
  const otherTime = required<HTMLInputElement>(otherForm, 'input[name="time"]');
  const otherError = (field: string) =>
    required<HTMLElement>(otherForm, `[data-error-for="${field}"]`);

  let drinks = drinksStore.load();
  let settings = settingsStore.load();
  let day = today();

  const announce = (message: string): void => {
    announcer.textContent = message;
  };
  const unit = (): Unit => unitOf(settings);
  const amount = (ml: number): string => formatAmount(ml, unit());

  /** Saves, shows the change, and tells the notification service and other devices. */
  function save(next: { drinks?: DrinksState; settings?: SettingsState }, message: string | null) {
    let ok = true;
    if (next.drinks) {
      drinks = next.drinks;
      ok = drinksStore.save(drinks) && ok;
    }
    if (next.settings) {
      settings = next.settings;
      ok = settingsStore.save(settings) && ok;
    }
    if (reportSave(ok) && message) announce(message);
    render();
    reminders.changed();
    sync.changed();
  }

  // ---------- Showing it ----------

  function renderDrink(drink: Drink): HTMLLIElement {
    const fragment = drinkTemplate.content.cloneNode(true) as DocumentFragment;
    const item = required<HTMLLIElement>(fragment, 'li');
    item.dataset['id'] = drink.id;
    const time = timeLabel(drink.time);
    required<HTMLElement>(item, '[data-time]').textContent = time;
    required<HTMLElement>(item, '[data-amount]').textContent = amount(drink.ml);
    required<HTMLElement>(item, '[data-action="remove"]').setAttribute(
      'aria-label',
      `Remove ${amount(drink.ml)} at ${time}`,
    );
    return item;
  }

  function renderDay(entry: DayTotal, goal: number): HTMLLIElement {
    const fragment = dayTemplate.content.cloneNode(true) as DocumentFragment;
    const item = required<HTMLLIElement>(fragment, 'li');
    required<HTMLElement>(item, '[data-day-name]').textContent = dayLabel(entry.date, day);
    required<HTMLElement>(item, '[data-day-total]').textContent = amount(entry.ml);
    if (!entry.reached) required<HTMLElement>(item, '[data-day-reached]').remove();
    const bar = required<HTMLProgressElement>(item, '[data-day-progress]');
    bar.max = goal;
    // Full once reached (that can be a little short: see reachedOn).
    bar.value = entry.reached ? goal : Math.min(entry.ml, goal);
    return item;
  }

  function renderToday(): void {
    const total = totalOn(drinks, day, unit());
    const goal = amountOf(settings, 'goal');
    const reached = reachedOn(drinks, day, goal);
    dateText.textContent = dateFormat.format(dateOf(day));
    totalText.textContent = amount(total);
    goalText.textContent = amount(goal);
    progress.max = goal;
    progress.value = reached ? goal : Math.min(total, goal);
    leftText.textContent = reached ? GOAL_REACHED : progressText(total, goal, unit());
    for (const size of ['glass', 'bottle'] as const) {
      required<HTMLElement>(root, `[data-size="${size}"]`).textContent = amount(
        amountOf(settings, size),
      );
    }
    const todays = drinksOn(drinks, day);
    noDrinks.hidden = todays.length > 0;
    drinkList.hidden = todays.length === 0;
    drinkList.replaceChildren(...todays.map(renderDrink));
  }

  function renderHistory(): void {
    const goal = amountOf(settings, 'goal');
    const days = recentDays(drinks, goal, day, 7, unit());
    const count = streak(drinks, goal, day);
    streakLine.textContent = streakText(count);
    streakLine.hidden = count === 0;
    averageLine.textContent = days.some((entry) => entry.ml > 0)
      ? `On average, ${amount(averageOf(days))} a day.`
      : 'Nothing logged in the last 7 days yet.';
    dayList.replaceChildren(...days.map((entry) => renderDay(entry, goal)));
  }

  /** Fills in the settings, except a field being typed in. */
  function renderSettings(): void {
    const current = unit();
    for (const radio of unitRadios) radio.checked = radio.value === current;
    for (const label of root.querySelectorAll('[data-unit-label]')) {
      label.textContent = UNIT_LABELS[current];
    }
    for (const name of AMOUNTS) {
      const input = amountInput(name);
      const [min, max] = LIMITS[current][name === 'goal' ? 'goal' : 'drink'];
      input.min = String(min);
      input.max = String(max);
      if (input === root.activeElement) continue;
      input.value = String(inUnit(amountOf(settings, name), current));
      showProblem(input, amountError(name), undefined);
    }
    const [min, max] = LIMITS[current].drink;
    otherAmount.min = String(min);
    otherAmount.max = String(max);

    const reminders = remindersOf(settings);
    remindersOn.checked = reminders.on;
    if (reminderEvery !== root.activeElement) reminderEvery.value = String(reminders.every);
    if (reminderFrom === root.activeElement || reminderUntil === root.activeElement) return;
    reminderFrom.value = reminders.from;
    reminderUntil.value = reminders.until;
    reminderError.textContent = '';
    reminderFrom.removeAttribute('aria-invalid');
    reminderUntil.removeAttribute('aria-invalid');
  }

  function render(): void {
    renderToday();
    renderHistory();
    renderSettings();
  }

  // ---------- Adding and removing drinks ----------

  /** Adds a drink; says what's wrong instead if the day is full. */
  function add(ml: number, date: IsoDate, time: IsoTime): void {
    const goal = amountOf(settings, 'goal');
    const next = addDrink(drinks, { id: crypto.randomUUID(), date, time, ml });
    const total = totalOn(next, day, unit());
    const when = date === day ? '' : ` ${dayLabel(date, day).toLowerCase()}`;
    let message = `Added ${amount(ml)}${when}. ${amount(total)} of ${amount(goal)} today.`;
    if (!reachedOn(drinks, day, goal) && reachedOn(next, day, goal)) {
      message += ` ${GOAL_REACHED}`;
    }
    save({ drinks: next }, message);
  }

  for (const size of ['glass', 'bottle'] as const) {
    required<HTMLButtonElement>(root, `[data-add="${size}"]`).addEventListener('click', () => {
      const now = nowStamp();
      const date = now.slice(0, 10);
      const problem = drinkProblem(drinks, date);
      if (problem) {
        announce(problem);
        leftText.textContent = problem;
        return;
      }
      add(amountOf(settings, size), date, now.slice(11, 16));
    });
  }

  drinkList.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-action="remove"]');
    const item = button?.closest<HTMLLIElement>('li');
    const drink = drinks.drinks.find((entry) => entry.id === item?.dataset['id']);
    if (!item || !drink) return;
    const index = [...drinkList.children].indexOf(item);
    save({ drinks: removeDrink(drinks, drink.id) }, `Removed ${amount(drink.ml)}.`);
    // Keep keyboard focus in the list (or go back to the buttons when it's empty).
    const buttons = drinkList.querySelectorAll<HTMLButtonElement>('[data-action="remove"]');
    const next = buttons[Math.min(index, buttons.length - 1)];
    (next ?? required<HTMLButtonElement>(root, '[data-add="glass"]')).focus();
  });

  // "Other amount": any amount, at another time today or yesterday.
  otherButton.addEventListener('click', () => {
    otherForm.reset();
    for (const field of ['amount', 'time', 'day']) otherError(field).textContent = '';
    otherAmount.removeAttribute('aria-invalid');
    otherTime.removeAttribute('aria-invalid');
    const option = (date: IsoDate) => new Option(dayLabel(date, day), date);
    otherDay.replaceChildren(option(day), option(addDays(day, -1)));
    otherTime.value = nowStamp().slice(11, 16);
    otherDialog.showModal();
  });

  otherForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const amountText = amountProblem(otherAmount.value, unit(), 'drink');
    const date = otherDay.value;
    const time = otherTime.value;
    let timeText: string | undefined;
    if (!isIsoTime(time)) timeText = 'Choose a time.';
    else if (toStamp(date, time) > nowStamp()) timeText = 'Choose a time that has already come.';
    const dayText = isIsoDate(date) ? drinkProblem(drinks, date) : 'Choose a day.';
    showProblem(otherAmount, otherError('amount'), amountText);
    showProblem(otherTime, otherError('time'), timeText);
    otherError('day').textContent = dayText ?? '';
    if (amountText) focusProblem(otherAmount, amountText);
    else if (timeText) focusProblem(otherTime, timeText);
    else if (dayText) focusProblem(otherDay, dayText);
    if (amountText || timeText || dayText) return;
    otherDialog.close();
    add(typedMl(otherAmount.value, unit()), date, time);
  });

  otherForm.addEventListener('click', (event) => {
    if ((event.target as Element).closest('[data-action="cancel"]')) otherDialog.close();
  });

  // ---------- Goal and sizes ----------

  /** Saves a goal or size; `entered`: after Enter in its field, which reads a problem out. */
  function commitAmount(name: Amount, entered = false): void {
    const input = amountInput(name);
    const problem = amountProblem(input.value, unit(), name === 'goal' ? 'goal' : 'drink');
    showProblem(input, amountError(name), problem);
    if (problem) {
      if (entered) focusProblem(input, problem);
      // Read out too once focus has settled: by the field if it's still there
      // (Enter, which can't send this form of number fields), or on the page
      // if it has gone on (Tab). Else nothing told a screen reader user it
      // wasn't saved (audit 3 G-5).
      else {
        window.setTimeout(() => {
          if (input.getAttribute('aria-invalid') !== 'true') return;
          if (root.activeElement === input) focusProblem(input, problem);
          else announce(`${AMOUNT_LABELS[name]}: ${problem}`);
        });
      }
      return;
    }
    const ml = typedMl(input.value, unit());
    if (ml === amountOf(settings, name)) return;
    save({ settings: setAmount(settings, name, ml) }, `${AMOUNT_LABELS[name]}: ${amount(ml)}.`);
  }

  for (const name of AMOUNTS) {
    amountInput(name).addEventListener('change', () => commitAmount(name));
  }
  // Enter in a field saves it too.
  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = (root.activeElement as HTMLElement | null)?.dataset['amount'];
    if (AMOUNTS.includes(name as Amount)) commitAmount(name as Amount, true);
  });

  for (const radio of unitRadios) {
    radio.addEventListener('change', () => {
      const chosen = UNITS.find((entry) => entry === radio.value);
      if (!radio.checked || !chosen || chosen === unit()) return;
      save({ settings: setUnit(settings, chosen) }, `Amounts are in ${UNIT_NAMES[chosen]} now.`);
    });
  }

  // ---------- Reminders ----------

  function commitReminders(): void {
    const next = {
      on: remindersOn.checked,
      every: Number(reminderEvery.value),
      from: reminderFrom.value,
      until: reminderUntil.value,
    };
    const fromWrong = !isIsoTime(next.from);
    const untilWrong = !isIsoTime(next.until) || (!fromWrong && next.until < next.from);
    reminderError.textContent = fromWrong
      ? 'Choose when reminders start.'
      : untilWrong
        ? 'Choose an “Until” time after the “From” time.'
        : '';
    for (const [input, wrong] of [
      [reminderFrom, fromWrong],
      [reminderUntil, untilWrong],
    ] as const) {
      if (wrong) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    if (fromWrong || untilWrong) {
      // Changed while in one of the times: read the problem out (focus stays there).
      const active = [reminderFrom, reminderUntil].find((input) => input === root.activeElement);
      if (active) focusProblem(active, reminderError.textContent ?? '');
      return;
    }
    const before = remindersOf(settings);
    if (JSON.stringify(before) === JSON.stringify(next)) return;
    const message = next.on
      ? `Reminders ${everyLabel(next.every).toLowerCase()}, from ${timeLabel(next.from)} until ${timeLabel(next.until)}.`
      : 'Reminders are off.';
    save({ settings: setReminders(settings, next) }, message);
    if (next.on) reminders.offerNotifications();
  }

  for (const control of [remindersOn, reminderEvery, reminderFrom, reminderUntil]) {
    control.addEventListener('change', commitReminders);
  }

  // ---------- Keeping up ----------

  /** Draws it all again in the background: keyboard focus stays where it was (audit G-3). */
  const redraw = (draw: () => void = render): void => {
    keepFocus(draw, required<HTMLButtonElement>(root, '[data-add="glass"]'));
  };

  function reload(): void {
    drinks = drinksStore.load();
    settings = settingsStore.load();
    redraw();
    reminders.changed();
  }

  /**
   * Lets go of drinks older than a year. While sync is on, what's let go
   * here is deleted on every device, so a clock set far ahead mustn't
   * decide: it counts back from the sync server's clock at the last sync, if
   * that's earlier, and waits while that isn't known (audit F1-4). With sync
   * off, from this device's clock.
   */
  function prune(): void {
    const now = sync.trustedNow();
    if (now === null) return;
    const pruned = pruneDrinks(drinks, today(new Date(now)));
    if (pruned !== drinks) save({ drinks: pruned }, null);
  }

  // A new day while Water is open (or when it comes back on screen).
  const checkDay = (): void => {
    if (today() === day) return;
    day = today();
    // Letting go of old drinks draws it again too.
    redraw(() => {
      render();
      prune();
    });
    reminders.changed();
  };
  window.setInterval(checkDay, NEW_DAY_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDay();
  });

  // If Water is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    if (event.key === drinksStore.key || event.key === settingsStore.key) reload();
  });

  // Sync between devices through the shkriuss account (if turned on). Drinks
  // are only added or removed, never changed, so they never conflict; for
  // each setting, the newest change wins.
  const sync = createSync({
    app: site.slug,
    stores: [
      syncedStore({
        store: drinksStore,
        items: (value) => value.drinks,
        withItems: (_value, items) => withDrinks(items),
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

  const reminders = mountReminders(root, {
    drinks: () => drinks,
    settings: () => settings,
    announce,
  });

  render();
  prune();
}
