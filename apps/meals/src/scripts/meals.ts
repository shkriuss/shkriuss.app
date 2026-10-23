/**
 * Meals' page behaviour: connects pages/index.astro to the rules in
 * lib/meals.ts and saves everything on the device.
 *
 * The page shows one week at a time (from the day weeks start where you
 * are): each day with what's planned, then that week's shopping list, then
 * your meals. "Add a meal" on a day plans something; tapping a planned meal
 * changes or removes it. A planned meal with the name of one of your meals
 * puts that meal's ingredients on the shopping list. Reminders tell what's
 * planned at the time chosen for each meal of the day (./reminders.ts). When
 * sync is on, the newest change to each planned meal, shopping tick and
 * reminder time wins; a meal changed on two devices at once is kept in both
 * versions.
 */
import { addDays, firstDayOfWeek, today as todayOf, type IsoDate } from '@shkriuss/dates';
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { focusProblem, reportSave } from '@shkriuss/ui/problem';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { site } from 'virtual:shkriuss/site';
import {
  addExtra,
  addMeal,
  addPlanned,
  copyWeek,
  DEFAULT_REMINDER_TIMES,
  defaultSlot,
  emptyMeals,
  emptyPlan,
  emptyReminders,
  emptyShopping,
  extraProblem,
  findMeal,
  formatDay,
  formatWeek,
  ingredientsText,
  isMealsState,
  isPlanState,
  isRemindersState,
  isShoppingState,
  mealDraftOf,
  mealFromDraft,
  mealProblems,
  MEALS_VERSION,
  PLAN_VERSION,
  plannedFromDraft,
  plannedInWeek,
  plannedOn,
  planProblems,
  pruneShopping,
  REMINDERS_VERSION,
  reminderTime,
  removeExtra,
  removeMeal,
  removePlanned,
  renamePlanned,
  rowText,
  secondVersion,
  setDone,
  setReminder,
  SHOPPING_VERSION,
  SHOPPING_WEEKS_KEPT,
  shoppingList,
  shoppingText,
  SLOTS,
  SLOT_LABELS,
  sortedMeals,
  suggestions,
  updateMeal,
  updatePlanned,
  weekDays,
  weekName,
  weekStartOf,
  withReminders,
  type Meal,
  type MealDraft,
  type MealField,
  type MealsState,
  type Planned,
  type PlanDraft,
  type PlanField,
  type PlanState,
  type RemindersState,
  type ShoppingRow,
  type ShoppingState,
  type Slot,
} from '../lib/meals.ts';
import { mountReminders } from './reminders.ts';

const mealsStore = createStore<MealsState>({
  key: 'meals',
  version: MEALS_VERSION,
  fallback: emptyMeals,
  validate: isMealsState,
});

const planStore = createStore<PlanState>({
  key: 'meal-plan',
  version: PLAN_VERSION,
  fallback: emptyPlan,
  validate: isPlanState,
});

const shoppingStore = createStore<ShoppingState>({
  key: 'meal-shopping',
  version: SHOPPING_VERSION,
  fallback: emptyShopping,
  validate: isShoppingState,
});

/** When to be reminded of what's planned (synced between devices). */
const remindersStore = createStore<RemindersState>({
  key: 'meal-reminders',
  version: REMINDERS_VERSION,
  fallback: emptyReminders,
  validate: isRemindersState,
});

/** How often to look for a new day (the "Today" mark moves at midnight). */
const NEW_DAY_CHECK_MS = 60_000;

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Meals: missing element ${selector}`);
  return element;
}

export function mountMeals(root: Document): void {
  const announcer = required<HTMLElement>(root, '[data-announcer]');
  const weekHeading = required<HTMLElement>(root, '[data-week-heading]');
  const weekDates = required<HTMLElement>(root, '[data-week-dates]');
  const thisWeekButton = required<HTMLButtonElement>(root, '[data-action="this-week"]');
  const copyWeekOffer = required<HTMLElement>(root, '[data-copy-week]');
  const dayList = required<HTMLOListElement>(root, '[data-days]');
  const dayTemplate = required<HTMLTemplateElement>(root, '[data-day-template]');
  const plannedTemplate = required<HTMLTemplateElement>(root, '[data-planned-template]');

  const shoppingFor = required<HTMLElement>(root, '[data-shopping-for]');
  const shoppingEmpty = required<HTMLElement>(root, '[data-shopping-empty]');
  const shoppingListElement = required<HTMLUListElement>(root, '[data-shopping]');
  const rowTemplate = required<HTMLTemplateElement>(root, '[data-row-template]');
  const extraForm = required<HTMLFormElement>(root, '[data-extra-form]');
  const extraInput = required<HTMLInputElement>(root, '[data-extra]');
  const extraError = required<HTMLElement>(root, '[data-extra-error]');
  const copyListButton = required<HTMLButtonElement>(root, '[data-action="copy-list"]');
  const shoppingStatus = required<HTMLElement>(root, '[data-shopping-status]');

  const mealList = required<HTMLUListElement>(root, '[data-meals]');
  const noMeals = required<HTMLElement>(root, '[data-no-meals]');
  const mealTemplate = required<HTMLTemplateElement>(root, '[data-meal-template]');
  const newMealButton = required<HTMLButtonElement>(root, '[data-action="new-meal"]');
  const suggestionList = required<HTMLDataListElement>(root, '[data-suggestions]');

  const planDialog = required<HTMLDialogElement>(root, '[data-plan-dialog]');
  const planForm = required<HTMLFormElement>(planDialog, '[data-plan-form]');
  const planTitle = required<HTMLElement>(planDialog, '[data-plan-title]');
  const planHint = required<HTMLElement>(planDialog, '[data-plan-hint]');
  const planName = required<HTMLInputElement>(planForm, '[name="name"]');
  const planDate = required<HTMLSelectElement>(planForm, '[name="date"]');
  const planSlot = required<HTMLSelectElement>(planForm, '[name="slot"]');
  const removePlannedButton = required<HTMLButtonElement>(
    planForm,
    '[data-action="remove-planned"]',
  );

  const mealDialog = required<HTMLDialogElement>(root, '[data-meal-dialog]');
  const mealForm = required<HTMLFormElement>(mealDialog, '[data-meal-form]');
  const mealTitle = required<HTMLElement>(mealDialog, '[data-meal-title]');
  const mealName = required<HTMLInputElement>(mealForm, '[name="name"]');
  const mealIngredients = required<HTMLTextAreaElement>(mealForm, '[name="ingredients"]');
  const mealNotes = required<HTMLTextAreaElement>(mealForm, '[name="notes"]');
  const planMealButton = required<HTMLButtonElement>(mealForm, '[data-action="plan-meal"]');
  const deleteMealButton = required<HTMLButtonElement>(mealForm, '[data-action="delete-meal"]');
  const deleteDialog = required<HTMLDialogElement>(root, '[data-delete-dialog]');
  const deleteName = required<HTMLElement>(deleteDialog, '[data-delete-name]');

  const firstDay = firstDayOfWeek(navigator.language);
  let today = todayOf();
  let thisWeek = weekStartOf(today, firstDay);
  /** The week on the page (its first day). */
  let shown = thisWeek;

  let meals = mealsStore.load();
  let plan = planStore.load();
  let shopping = shoppingStore.load();
  let reminders = remindersStore.load();
  /** What's on the shown week's shopping list, as last drawn. */
  let rows: ShoppingRow[] = [];

  /** The planned meal or meal open in a form (null: a new one). */
  let editingPlanned: string | null = null;
  let editingMeal: string | null = null;

  const announce = (text: string): void => {
    announcer.textContent = text;
  };
  /** Something on the page with this id (a planned meal or one of your meals). */
  const byId = (container: ParentNode, id: string, selector: string): HTMLElement | null =>
    container.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] ${selector}`);
  const describe = (entry: Planned): string =>
    `${entry.name}: ${SLOT_LABELS[entry.slot].toLowerCase()}, ${formatDay(entry.date)}`;

  // ---------- Saving ----------
  // Each gives false (and the person is told, in the notice at the top) if it couldn't save.
  // With `report` false, the caller tells the person (after saving something else too).

  function saveMeals(next: MealsState, report = true): boolean {
    meals = next;
    const saved = mealsStore.save(meals);
    sync.changed();
    return report ? reportSave(saved) : saved;
  }

  function savePlan(next: PlanState, report = true): boolean {
    plan = next;
    const saved = planStore.save(plan);
    sync.changed();
    reminderControls.changed();
    return report ? reportSave(saved) : saved;
  }

  function saveShopping(next: ShoppingState): boolean {
    shopping = next;
    const saved = reportSave(shoppingStore.save(shopping));
    sync.changed();
    return saved;
  }

  // ---------- The week ----------

  function renderPlanned(entry: Planned): HTMLLIElement {
    const item = required<HTMLLIElement>(
      plannedTemplate.content.cloneNode(true) as DocumentFragment,
      'li',
    );
    item.dataset['id'] = entry.id;
    required<HTMLElement>(item, '[data-slot]').textContent = SLOT_LABELS[entry.slot];
    required<HTMLElement>(item, '[data-name]').textContent = entry.name;
    return item;
  }

  function renderDay(date: IsoDate): HTMLLIElement {
    const day = required<HTMLLIElement>(
      dayTemplate.content.cloneNode(true) as DocumentFragment,
      'li',
    );
    day.dataset['date'] = date;
    const isToday = date === today;
    day.classList.toggle('day--today', isToday);
    required<HTMLElement>(day, '[data-day-title]').textContent = formatDay(date);
    required<HTMLElement>(day, '[data-today]').hidden = !isToday;
    const entries = plannedOn(plan, date);
    required<HTMLElement>(day, '[data-day-meals]').replaceChildren(...entries.map(renderPlanned));
    required<HTMLElement>(day, '[data-day-empty]').hidden = entries.length > 0;
    required<HTMLElement>(day, '[data-plan-day]').textContent = ` on ${formatDay(date)}`;
    return day;
  }

  function renderWeek(): void {
    const name = weekName(shown, thisWeek);
    weekHeading.textContent = name ?? formatWeek(shown);
    weekDates.textContent = name ? formatWeek(shown) : '';
    weekDates.hidden = name === null;
    thisWeekButton.hidden = shown === thisWeek;
    dayList.replaceChildren(...weekDays(shown).map(renderDay));
    copyWeekOffer.hidden =
      plannedInWeek(plan, shown).length > 0 || plannedInWeek(plan, addDays(shown, -7)).length === 0;
  }

  // ---------- The shopping list ----------

  function renderRow(row: ShoppingRow): HTMLLIElement {
    const item = required<HTMLLIElement>(
      rowTemplate.content.cloneNode(true) as DocumentFragment,
      'li',
    );
    item.dataset['key'] = row.key;
    const box = required<HTMLInputElement>(item, '[data-row-done]');
    box.checked = row.done;
    required<HTMLElement>(item, '[data-row-name]').textContent = rowText(row);
    required<HTMLElement>(item, '[data-row-for]').textContent =
      row.meals.length > 0 ? `For ${row.meals.join(', ')}` : '';
    const remove = required<HTMLButtonElement>(item, '[data-action="remove-extra"]');
    remove.hidden = !row.extra;
    remove.setAttribute('aria-label', `Remove “${row.name}” from the list`);
    return item;
  }

  function renderShopping(): void {
    rows = shoppingList(plan, meals, shopping, shown);
    const name = weekName(shown, thisWeek);
    shoppingFor.textContent = `For ${name ? `${name.toLowerCase()} (${formatWeek(shown)})` : formatWeek(shown)}.`;
    shoppingListElement.replaceChildren(...rows.map(renderRow));
    shoppingEmpty.hidden = rows.length > 0;
    copyListButton.hidden = rows.every((row) => row.done);
  }

  // ---------- Your meals ----------

  function renderMeals(): void {
    const sorted = sortedMeals(meals);
    mealList.replaceChildren(
      ...sorted.map((meal) => {
        const item = required<HTMLLIElement>(
          mealTemplate.content.cloneNode(true) as DocumentFragment,
          'li',
        );
        item.dataset['id'] = meal.id;
        required<HTMLElement>(item, '[data-action="edit-meal"]').textContent = meal.name;
        required<HTMLElement>(item, '[data-meal-meta]').textContent = ingredientsText(meal);
        return item;
      }),
    );
    noMeals.hidden = sorted.length > 0;
    suggestionList.replaceChildren(
      ...suggestions(meals, plan).map((name) => {
        const option = document.createElement('option');
        option.value = name;
        return option;
      }),
    );
  }

  // ---------- Reminders ----------

  const reminderControls = mountReminders(root, {
    plan: () => plan,
    reminders: () => reminders,
    announce,
  });

  const reminderBox = (slot: Slot) =>
    required<HTMLInputElement>(root, `[data-reminder-on="${slot}"]`);
  const reminderInput = (slot: Slot) =>
    required<HTMLInputElement>(root, `[data-reminder-time="${slot}"]`);

  function renderReminders(): void {
    for (const slot of SLOTS) {
      const time = reminderTime(reminders, slot);
      reminderBox(slot).checked = time !== null;
      if (time !== null) reminderInput(slot).value = time;
    }
  }

  function setReminderTime(slot: Slot, time: string | null): void {
    reminders = setReminder(reminders, slot, time);
    const stored = reportSave(remindersStore.save(reminders));
    sync.changed();
    reminderControls.changed();
    renderReminders();
    if (!stored) return;
    const saved = reminderTime(reminders, slot);
    if (saved === null) {
      announce(`No ${SLOT_LABELS[slot].toLowerCase()} reminder.`);
    } else {
      reminderControls.offerNotifications();
      announce(`${SLOT_LABELS[slot]} reminder at ${saved}.`);
    }
  }

  for (const slot of SLOTS) {
    reminderBox(slot).addEventListener('change', () => {
      const typed = reminderInput(slot).value;
      setReminderTime(
        slot,
        reminderBox(slot).checked ? typed || DEFAULT_REMINDER_TIMES[slot] : null,
      );
    });
    // Choosing a time turns the reminder on (clearing it turns it off).
    reminderInput(slot).addEventListener('change', () => {
      setReminderTime(slot, reminderInput(slot).value || null);
    });
  }

  function render(): void {
    renderWeek();
    renderShopping();
    renderMeals();
    renderReminders();
  }

  function showWeek(start: IsoDate): void {
    shown = start;
    shoppingStatus.textContent = '';
    render();
    const name = weekName(shown, thisWeek);
    announce(name ? `${name}: ${formatWeek(shown)}.` : `${formatWeek(shown)}.`);
  }

  // ---------- Planning a meal ----------

  function planHintFor(name: string): string {
    if (name.trim() === '') return 'Type a name, or choose one of your meals.';
    const meal = findMeal(meals, name);
    if (!meal) return 'Not one of your meals. Add it under “Your meals” to give it ingredients.';
    return meal.ingredients.length > 0
      ? 'Its ingredients go on the shopping list.'
      : `“${meal.name}” has no ingredients yet.`;
  }

  function showPlanProblems(problems: Partial<Record<PlanField, string>>): void {
    for (const field of ['name', 'form'] as const) {
      const error = required<HTMLElement>(planForm, `[data-error-for="${field}"]`);
      error.textContent = problems[field] ?? '';
    }
    planName.toggleAttribute('aria-invalid', problems.name !== undefined);
  }

  /** Opens the plan form for a planned meal, or for a new one on `date`. */
  function openPlan(entry: Planned | null, date: IsoDate, name = ''): void {
    editingPlanned = entry?.id ?? null;
    planTitle.textContent = entry ? 'Change meal' : 'Add a meal';
    removePlannedButton.hidden = !entry;
    planDate.replaceChildren(
      ...weekDays(weekStartOf(entry?.date ?? date, firstDay)).map((day) => {
        const option = document.createElement('option');
        option.value = day;
        option.textContent = formatDay(day);
        return option;
      }),
    );
    planDate.value = entry?.date ?? date;
    planSlot.value = entry?.slot ?? defaultSlot(plan, date);
    planName.value = entry?.name ?? name;
    planHint.textContent = planHintFor(planName.value);
    showPlanProblems({});
    planDialog.showModal();
    planName.focus();
  }

  planName.addEventListener('input', () => {
    planHint.textContent = planHintFor(planName.value);
  });

  planForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const draft: PlanDraft = {
      name: planName.value,
      date: planDate.value,
      slot: planSlot.value as Slot,
    };
    const problems = planProblems(plan, draft, editingPlanned ?? undefined);
    showPlanProblems(problems);
    if (Object.keys(problems).length > 0) {
      // A problem with the whole form is read out by itself (role="alert").
      if (problems.name) focusProblem(planName, problems.name);
      else planName.focus();
      return;
    }
    const entry = plannedFromDraft(draft, editingPlanned ?? crypto.randomUUID());
    const saved = savePlan(editingPlanned ? updatePlanned(plan, entry) : addPlanned(plan, entry));
    planDialog.close();
    render();
    if (saved) announce(`${editingPlanned ? 'Changed' : 'Added'} ${describe(entry)}.`);
    byId(dayList, entry.id, '[data-action="edit-planned"]')?.focus();
  });

  removePlannedButton.addEventListener('click', () => {
    const entry = plan.planned.find((planned) => planned.id === editingPlanned);
    planDialog.close();
    if (!entry) return;
    const saved = savePlan(removePlanned(plan, entry.id));
    render();
    if (saved) announce(`Removed ${describe(entry)}.`);
    dayList.querySelector<HTMLElement>(`[data-date="${entry.date}"] [data-action="plan"]`)?.focus();
  });

  required<HTMLButtonElement>(planForm, '[data-action="cancel-plan"]').addEventListener(
    'click',
    () => {
      planDialog.close();
    },
  );

  // ---------- Your meals' form ----------

  function showMealProblems(problems: Partial<Record<MealField, string>>): void {
    for (const field of ['name', 'ingredients', 'notes', 'form'] as const) {
      const error = required<HTMLElement>(mealForm, `[data-error-for="${field}"]`);
      error.textContent = problems[field] ?? '';
    }
    mealName.toggleAttribute('aria-invalid', problems.name !== undefined);
    mealIngredients.toggleAttribute('aria-invalid', problems.ingredients !== undefined);
    mealNotes.toggleAttribute('aria-invalid', problems.notes !== undefined);
  }

  function openMeal(meal: Meal | null): void {
    editingMeal = meal?.id ?? null;
    mealTitle.textContent = meal ? 'Edit meal' : 'New meal';
    planMealButton.hidden = !meal;
    deleteMealButton.hidden = !meal;
    const draft = mealDraftOf(meal ?? undefined);
    mealName.value = draft.name;
    mealIngredients.value = draft.ingredients;
    mealNotes.value = draft.notes;
    showMealProblems({});
    mealDialog.showModal();
    mealName.focus();
  }

  mealForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const draft: MealDraft = {
      name: mealName.value,
      ingredients: mealIngredients.value,
      notes: mealNotes.value,
    };
    const problems = mealProblems(meals, draft, editingMeal ?? undefined);
    showMealProblems(problems);
    if (Object.keys(problems).length > 0) {
      // The first field with a problem (or the name, for the whole form, whose
      // problem is read out by itself).
      if (problems.name) focusProblem(mealName, problems.name);
      else if (problems.ingredients) focusProblem(mealIngredients, problems.ingredients);
      else if (problems.notes) focusProblem(mealNotes, problems.notes);
      else mealName.focus();
      return;
    }
    const before = meals.meals.find((meal) => meal.id === editingMeal);
    const meal = mealFromDraft(draft, editingMeal ?? crypto.randomUUID());
    let stored = saveMeals(before ? updateMeal(meals, meal) : addMeal(meals, meal), false);
    // Renamed: what's planned with the old name follows.
    if (before) {
      const renamed = renamePlanned(plan, before.name, meal.name);
      if (renamed !== plan) stored = savePlan(renamed, false) && stored;
    }
    const saved = reportSave(stored);
    mealDialog.close();
    render();
    if (saved) announce(`Saved “${meal.name}”.`);
    byId(mealList, meal.id, '[data-action="edit-meal"]')?.focus();
  });

  required<HTMLButtonElement>(mealForm, '[data-action="cancel-meal"]').addEventListener(
    'click',
    () => {
      mealDialog.close();
    },
  );

  planMealButton.addEventListener('click', () => {
    const meal = meals.meals.find((entry) => entry.id === editingMeal);
    mealDialog.close();
    if (meal)
      openPlan(null, today >= shown && today <= addDays(shown, 6) ? today : shown, meal.name);
  });

  deleteMealButton.addEventListener('click', () => {
    const meal = meals.meals.find((entry) => entry.id === editingMeal);
    if (!meal) return;
    deleteName.textContent = meal.name;
    deleteDialog.returnValue = '';
    deleteDialog.showModal();
  });

  deleteDialog.addEventListener('close', () => {
    const meal = meals.meals.find((entry) => entry.id === editingMeal);
    if (deleteDialog.returnValue !== 'confirm' || !meal) {
      mealName.focus();
      return;
    }
    mealDialog.close();
    const saved = saveMeals(removeMeal(meals, meal.id));
    render();
    if (saved) announce(`Deleted “${meal.name}”.`);
    newMealButton.focus();
  });

  // ---------- Buttons ----------

  root.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;
    const id = button.closest<HTMLElement>('[data-id]')?.dataset['id'] ?? '';
    switch (button.dataset['action']) {
      case 'previous-week':
        showWeek(addDays(shown, -7));
        break;
      case 'next-week':
        showWeek(addDays(shown, 7));
        break;
      case 'this-week':
        showWeek(thisWeek);
        weekHeading.focus();
        break;
      case 'plan':
        openPlan(null, button.closest<HTMLElement>('[data-date]')?.dataset['date'] ?? shown);
        break;
      case 'edit-planned': {
        const entry = plan.planned.find((planned) => planned.id === id);
        if (entry) openPlan(entry, entry.date);
        break;
      }
      case 'copy-week': {
        const { state, copied } = copyWeek(plan, addDays(shown, -7), shown, () =>
          crypto.randomUUID(),
        );
        const saved = savePlan(state);
        render();
        if (saved) announce(`Copied ${copied} ${copied === 1 ? 'meal' : 'meals'} from last week.`);
        weekHeading.focus();
        break;
      }
      case 'new-meal':
        openMeal(null);
        break;
      case 'edit-meal':
        openMeal(meals.meals.find((meal) => meal.id === id) ?? null);
        break;
      case 'remove-extra': {
        const key = button.closest<HTMLElement>('[data-key]')?.dataset['key'] ?? '';
        const row = rows.find((entry) => entry.key === key);
        const saved = saveShopping(removeExtra(shopping, key));
        renderShopping();
        if (saved && row) announce(`Removed “${row.name}” from the list.`);
        extraInput.focus();
        break;
      }
      case 'copy-list': {
        const text = shoppingText(rows);
        navigator.clipboard.writeText(text).then(
          () => {
            shoppingStatus.textContent = 'Copied. You can paste it in a message.';
          },
          () => {
            shoppingStatus.textContent = 'Couldn’t copy. Your browser may not allow it.';
          },
        );
        break;
      }
      default:
    }
  });

  // ---------- Shopping ----------

  shoppingListElement.addEventListener('change', (event) => {
    const box = event.target as HTMLInputElement;
    const key = box.closest<HTMLElement>('[data-key]')?.dataset['key'] ?? '';
    const row = rows.find((entry) => entry.key === key);
    if (!row) return;
    const saved = saveShopping(setDone(shopping, shown, row, box.checked));
    renderShopping();
    shoppingStatus.textContent = '';
    if (saved) {
      announce(box.checked ? `Ticked off ${row.name}.` : `${row.name} is back on the list.`);
    }
    shoppingListElement
      .querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"] [data-row-done]`)
      ?.focus();
  });

  extraForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const problem = extraProblem(shopping, extraInput.value);
    extraError.textContent = problem ?? '';
    extraInput.toggleAttribute('aria-invalid', problem !== null);
    if (problem) {
      focusProblem(extraInput, problem);
      return;
    }
    const name = extraInput.value.trim();
    const saved = saveShopping(addExtra(shopping, shown, name, crypto.randomUUID()));
    extraInput.value = '';
    shoppingStatus.textContent = '';
    renderShopping();
    if (saved) announce(`Added “${name}” to the list.`);
    extraInput.focus();
  });

  // ---------- Keeping up ----------

  /** Lets go of shopping lists from long ago. */
  function prune(): void {
    const pruned = pruneShopping(shopping, addDays(thisWeek, -7 * SHOPPING_WEEKS_KEPT));
    if (pruned !== shopping) saveShopping(pruned);
  }

  function reload(): void {
    meals = mealsStore.load();
    plan = planStore.load();
    shopping = shoppingStore.load();
    reminders = remindersStore.load();
    reminderControls.changed();
    render();
  }

  // A new day: move "Today" (and this week, if the page was showing it).
  window.setInterval(() => {
    const now = todayOf();
    if (now === today) return;
    const wasThisWeek = shown === thisWeek;
    today = now;
    thisWeek = weekStartOf(today, firstDay);
    if (wasThisWeek) shown = thisWeek;
    prune();
    render();
  }, NEW_DAY_CHECK_MS);

  // If Meals is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    if (
      event.key === null ||
      [mealsStore.key, planStore.key, shoppingStore.key, remindersStore.key].includes(event.key)
    ) {
      reload();
    }
  });

  // Sync between devices through the shkriuss account (if turned on).
  const sync = createSync({
    app: site.slug,
    stores: [
      syncedStore({
        store: mealsStore,
        items: (value) => value.meals,
        withItems: (value, list) => ({ ...value, meals: list }),
        // Changed on two devices at once: keep this device's version as a meal of its own.
        conflictCopy: (mine) => secondVersion(mine, crypto.randomUUID()),
      }),
      syncedStore({
        store: planStore,
        items: (value) => value.planned,
        withItems: (value, planned) => ({ ...value, planned }),
      }),
      syncedStore({
        store: shoppingStore,
        items: (value) => value.items,
        withItems: (value, items) => ({ ...value, items }),
      }),
      syncedStore({
        store: remindersStore,
        items: (value) => value.reminders,
        withItems: (_value, items) => withReminders(items),
      }),
    ],
    onChange: reload,
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);

  prune();
  render();
}
