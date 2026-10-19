/**
 * Holidays, days off and fasts on the calendar (the rules are in
 * lib/holidays.ts): the choice of what to show, saved on this device, and the
 * pieces calendar.ts draws them with.
 */
import { createStore } from '@shkriuss/storage';
import type { IsoDate } from '../lib/dates.ts';
import {
  DEFAULT_SETTINGS,
  displayName,
  isSpecialDaySettings,
  kindLabel,
  marksOf,
  specialDaysBetween,
  specialDaysOn,
  type SpecialDay,
  type SpecialDaySettings,
} from '../lib/holidays.ts';
import { required, shortDate, utc } from './shared.ts';

const store = createStore<SpecialDaySettings>({
  key: 'calendar-holidays',
  version: 1,
  fallback: () => ({ ...DEFAULT_SETTINGS }),
  validate: isSpecialDaySettings,
});

const SETTINGS = ['daysOff', 'feasts', 'fasts', 'weeklyFasts'] as const;

export interface SpecialDays {
  on(date: IsoDate): SpecialDay[];
  between(from: IsoDate, to: IsoDate): Map<IsoDate, SpecialDay[]>;
  marks(days: readonly SpecialDay[]): ReturnType<typeof marksOf>;
  /** For a day in the month: "Christmas (day off)". */
  label(day: SpecialDay): string;
  /** A list item (not a button: these can't be changed). */
  item(day: SpecialDay, date: IsoDate, withDate: boolean): HTMLLIElement;
}

export function mountSpecialDays(root: Document, changed: () => void): SpecialDays {
  const template = required<HTMLTemplateElement>(root, '[data-special-template]');
  const legend = required<HTMLElement>(root, '[data-special-legend]');
  const inputs = SETTINGS.map((key) => ({
    key,
    input: required<HTMLInputElement>(root, `[data-special-setting="${key}"]`),
  }));
  let settings = store.load();

  function show(): void {
    for (const { key, input } of inputs) {
      input.checked = settings[key];
      // Wednesdays and Fridays are part of the fasts.
      if (key === 'weeklyFasts') input.disabled = !settings.fasts;
    }
    for (const entry of legend.querySelectorAll<HTMLElement>('[data-legend]')) {
      entry.hidden = !settings[entry.dataset['legend'] as keyof SpecialDaySettings];
    }
    legend.hidden = !settings.daysOff && !settings.feasts && !settings.fasts;
  }

  for (const { key, input } of inputs) {
    input.addEventListener('change', () => {
      settings = { ...settings, [key]: input.checked };
      store.save(settings);
      show();
      changed();
    });
  }

  // If Calendar is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    if (event.key !== store.key) return;
    settings = store.load();
    show();
    changed();
  });

  show();

  return {
    on: (date) => specialDaysOn(date, settings),
    between: (from, to) => specialDaysBetween(from, to, settings),
    marks: (days) => marksOf(days, settings),
    label: (day) =>
      day.dayOff && settings.daysOff ? `${displayName(day)} (day off)` : displayName(day),
    item(day, date, withDate) {
      const fragment = template.content.cloneNode(true) as DocumentFragment;
      const item = required<HTMLLIElement>(fragment, 'li');
      const marks = marksOf([day], settings);
      item.classList.add(
        marks.dayOff
          ? 'special-item--off'
          : marks.feast
            ? 'special-item--feast'
            : 'special-item--fast',
      );
      const kind = kindLabel(day, settings);
      required<HTMLElement>(item, '[data-kind]').textContent = withDate
        ? `${shortDate.format(utc(date))} · ${kind}`
        : kind;
      required<HTMLElement>(item, '[data-name]').textContent = displayName(day);
      required<HTMLElement>(item, '[data-name-ka]').textContent = day.nameKa;
      return item;
    },
  };
}
