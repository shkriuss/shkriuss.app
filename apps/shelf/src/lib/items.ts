/**
 * Shelf's data and rules, kept separate from the page so they're easy to
 * test. Every function returns a new state instead of changing the old one.
 *
 * An item is something you buy or use: food, clothes, tech, personal care…
 * with its brand, how you like it, its price, where to get it and a link.
 */
import { isIsoDate, parts, type IsoDate } from '@shkriuss/dates';
import { secondVersionName } from '@shkriuss/sync';
import { compareText } from '@shkriuss/ui/text';
import { DATE_LOCALE } from '@shkriuss/ui/locale';

/** An item's category when it has none. Categories themselves: ./categories.ts. */
export const NO_CATEGORY = '';

/** How you like it. */
export const OPINIONS = ['love', 'use', 'want', 'avoid'] as const;
export type Opinion = (typeof OPINIONS)[number];
export const OPINION_LABELS: Record<Opinion, string> = {
  love: 'Love it',
  use: 'Use it',
  want: 'Want to try',
  avoid: 'Won’t buy again',
};

/** Georgian lari first: the usual one here. */
export const CURRENCIES = ['GEL', 'USD', 'EUR', 'GBP', 'TRY', 'RUB'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const DEFAULT_CURRENCY: Currency = 'GEL';

export const SORTS = ['recent', 'name', 'brand', 'price'] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABELS: Record<Sort, string> = {
  recent: 'Recently changed',
  name: 'Name',
  brand: 'Brand',
  price: 'Price, low to high',
};

export interface Item {
  id: string;
  name: string;
  brand: string;
  /** A category's id, or NO_CATEGORY. */
  category: string;
  opinion: Opinion;
  /** In the currency's main unit (12.5 is 12.50), or null if not noted. */
  price: number | null;
  currency: Currency;
  /** Where to buy it. */
  shop: string;
  /** A web address (http or https), or "". */
  link: string;
  /** Size, colour, flavour… */
  variant: string;
  /** When it was last bought, or null. */
  bought: IsoDate | null;
  notes: string;
  /** When it was added and last changed (ms since 1970). */
  created: number;
  updated: number;
}

export interface ShelfState {
  items: Item[];
}

export const SHELF_VERSION = 1;
export const MAX_ITEMS = 5000;
export const LIMITS = { name: 200, brand: 100, shop: 100, variant: 100, link: 2000, notes: 5000 };
export const MAX_PRICE = 1_000_000_000;

export const emptyState = (): ShelfState => ({ items: [] });

const oneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  typeof value === 'string' && (options as readonly string[]).includes(value);
const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function isItem(value: unknown): value is Item {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  const texts = ['name', 'brand', 'shop', 'link', 'variant', 'notes'] as const;
  return (
    typeof item['id'] === 'string' &&
    item['id'].length > 0 &&
    texts.every((key) => typeof item[key] === 'string') &&
    typeof item['category'] === 'string' &&
    oneOf(item['opinion'], OPINIONS) &&
    oneOf(item['currency'], CURRENCIES) &&
    (item['price'] === null ||
      (typeof item['price'] === 'number' &&
        Number.isFinite(item['price']) &&
        item['price'] >= 0)) &&
    (item['bought'] === null || isIsoDate(item['bought'])) &&
    isTime(item['created']) &&
    isTime(item['updated'])
  );
}

/**
 * True when saved data has the shape Shelf expects. Only the shape: limits
 * apply when adding and editing, so items merged from several devices are
 * never rejected.
 */
export function isShelfState(value: unknown): value is ShelfState {
  if (typeof value !== 'object' || value === null) return false;
  const { items } = value as Record<string, unknown>;
  return Array.isArray(items) && items.every(isItem);
}

// ---------- The form ----------

/** What the form holds: text, as typed. */
export interface ItemDraft {
  name: string;
  brand: string;
  category: string;
  opinion: string;
  price: string;
  currency: string;
  shop: string;
  link: string;
  variant: string;
  bought: string;
  notes: string;
}

export type DraftField = 'name' | 'price' | 'link' | 'bought' | 'form';

/**
 * A price as typed: "12.50", "12,50" or "1 299" (spaces are ignored). Null
 * when empty; undefined when it isn't a price.
 */
export function parsePrice(text: string): number | null | undefined {
  const compact = text.replace(/\s/g, '');
  if (compact === '') return null;
  if (!/^\d+([.,]\d{1,2})?$/.test(compact)) return undefined;
  const price = Number(compact.replace(',', '.'));
  return price <= MAX_PRICE ? price : undefined;
}

/**
 * A link as typed: "shop.ge/item" becomes "https://shop.ge/item". "" when
 * empty; undefined when it isn't a web address (only http and https are
 * allowed, so a link can never run code).
 */
export function normalizeLink(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  // "shop.ge:8080/x" has no scheme: one with a dot in it is a host and port.
  const withScheme = /^[a-z][a-z\d+-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (!url.hostname.includes('.') || url.href.length > LIMITS.link) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** What's wrong with the form, by field (empty when it can be saved). */
export function draftProblems(draft: ItemDraft): Partial<Record<DraftField, string>> {
  const problems: Partial<Record<DraftField, string>> = {};
  if (draft.name.trim() === '') problems.name = 'Give it a name.';
  if (parsePrice(draft.price) === undefined) {
    problems.price = 'Write a price like 12.50, or leave it empty.';
  }
  if (normalizeLink(draft.link) === undefined) {
    problems.link = 'Write a web address like https://example.com, or leave it empty.';
  }
  if (draft.bought !== '' && !isIsoDate(draft.bought)) {
    problems.bought = 'Choose a date, or leave it empty.';
  }
  return problems;
}

const cut = (text: string, max: number): string => text.trim().slice(0, max);

/** The item a (checked) draft describes. Keeps `created` from the item it changes. */
export function itemFromDraft(draft: ItemDraft, id: string, now: number, existing?: Item): Item {
  return {
    id,
    name: cut(draft.name, LIMITS.name),
    brand: cut(draft.brand, LIMITS.brand),
    category: draft.category,
    opinion: oneOf(draft.opinion, OPINIONS) ? draft.opinion : 'use',
    price: parsePrice(draft.price) ?? null,
    currency: oneOf(draft.currency, CURRENCIES) ? draft.currency : DEFAULT_CURRENCY,
    shop: cut(draft.shop, LIMITS.shop),
    link: normalizeLink(draft.link) ?? '',
    variant: cut(draft.variant, LIMITS.variant),
    bought: isIsoDate(draft.bought) ? draft.bought : null,
    notes: draft.notes.trim().slice(0, LIMITS.notes),
    created: existing?.created ?? now,
    updated: now,
  };
}

/** The form's text for an item, to edit it. */
export function draftOf(item: Item): ItemDraft {
  return {
    name: item.name,
    brand: item.brand,
    category: item.category,
    opinion: item.opinion,
    // 4.5 shows as "4.50"; whole prices without decimals ("250").
    price:
      item.price === null
        ? ''
        : Number.isInteger(item.price)
          ? String(item.price)
          : item.price.toFixed(2),
    currency: item.currency,
    shop: item.shop,
    link: item.link,
    variant: item.variant,
    bought: item.bought ?? '',
    notes: item.notes,
  };
}

// ---------- Changes ----------

/** Adds an item, first in the list. The same state when there are already MAX_ITEMS. */
export function addItem(state: ShelfState, item: Item): ShelfState {
  if (state.items.length >= MAX_ITEMS) return state;
  return { items: [item, ...state.items] };
}

/** Puts in the changed item (added back if it was deleted on another device meanwhile). */
export function updateItem(state: ShelfState, item: Item): ShelfState {
  if (!state.items.some((entry) => entry.id === item.id)) return { items: [item, ...state.items] };
  return { items: state.items.map((entry) => (entry.id === item.id ? item : entry)) };
}

export function removeItem(state: ShelfState, id: string): ShelfState {
  return { items: state.items.filter((item) => item.id !== id) };
}

/** Moves every item in category `from` to `to` (NO_CATEGORY for none), when that category goes. */
export function moveItems(state: ShelfState, from: string, to: string): ShelfState {
  return {
    items: state.items.map((item) => (item.category === from ? { ...item, category: to } : item)),
  };
}

/**
 * An item changed on two devices at once: this device's version, kept as a
 * second item next to the other device's (packages/sync, conflictCopy).
 */
export const secondVersion = (item: Item, id: string): Item => ({
  ...item,
  id,
  name: secondVersionName(item.name, LIMITS.name),
});

// ---------- Showing them ----------

/** Text for comparing: lower case and without accents, so "cafe" finds "Café". */
export const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();

/** Alphabetical order, without minding case or accents ("item 2" before "item 10"). */
export const byText = compareText;

/** The item's category, or NO_CATEGORY if it's not one of `known` (deleted on another device). */
const categoryOf = (item: Item, known: ReadonlySet<string>): string =>
  known.has(item.category) ? item.category : NO_CATEGORY;

const idsOf = (categories: readonly { id: string }[]): Set<string> =>
  new Set(categories.map((category) => category.id));

export interface Filters {
  search: string;
  /** A category's id, NO_CATEGORY for items without one, or 'all'. */
  category: string;
  opinion: Opinion | 'all';
  /** Only this brand (any spelling of it), or null for all. */
  brand: string | null;
  sort: Sort;
}

export const NO_FILTERS: Filters = {
  search: '',
  category: 'all',
  opinion: 'all',
  brand: null,
  sort: 'recent',
};

/**
 * The items to list: those matching every filter and every word searched
 * for, sorted. `categories` are the ones that exist now.
 */
export function visibleItems(
  state: ShelfState,
  filters: Filters,
  categories: readonly { id: string }[],
): Item[] {
  const known = idsOf(categories);
  const words = fold(filters.search).split(/\s+/).filter(Boolean);
  const brand = filters.brand === null ? null : fold(filters.brand);
  const sorters: Record<Sort, (a: Item, b: Item) => number> = {
    recent: (a, b) => b.updated - a.updated,
    name: (a, b) => byText(a.name, b.name),
    brand: (a, b) =>
      Number(a.brand === '') - Number(b.brand === '') ||
      byText(a.brand, b.brand) ||
      byText(a.name, b.name),
    // Without a price: last. Prices in different currencies can't be compared
    // (no exchange rates), so each currency's come together.
    price: (a, b) =>
      Number(a.price === null) - Number(b.price === null) ||
      byText(a.currency, b.currency) ||
      (a.price ?? 0) - (b.price ?? 0) ||
      byText(a.name, b.name),
  };
  return state.items
    .filter((item) => {
      if (filters.category !== 'all' && categoryOf(item, known) !== filters.category) return false;
      if (filters.opinion !== 'all' && item.opinion !== filters.opinion) return false;
      if (brand !== null && fold(item.brand) !== brand) return false;
      const text = fold([item.name, item.brand, item.shop, item.variant, item.notes].join('\n'));
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => sorters[filters.sort](a, b) || (a.id < b.id ? -1 : 1));
}

export interface Brand {
  /** As written most often (the newest spelling when tied). */
  name: string;
  items: number;
  loved: number;
}

/** Every brand, the most loved first, then the one with the most items. */
export function brandsOf(state: ShelfState): Brand[] {
  const groups = new Map<
    string,
    { spellings: Map<string, number>; items: number; loved: number }
  >();
  const newestFirst = [...state.items].sort((a, b) => b.updated - a.updated);
  for (const item of newestFirst) {
    const key = fold(item.brand);
    if (key === '') continue;
    const group = groups.get(key) ?? { spellings: new Map<string, number>(), items: 0, loved: 0 };
    const spelling = item.brand.trim();
    group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + 1);
    group.items += 1;
    if (item.opinion === 'love') group.loved += 1;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ spellings, items, loved }) => {
      // Maps keep the order they were filled in: newest first wins a tie.
      let name = '';
      let most = 0;
      for (const [spelling, count] of spellings) {
        if (count > most) [name, most] = [spelling, count];
      }
      return { name, items, loved };
    })
    .sort((a, b) => b.loved - a.loved || b.items - a.items || byText(a.name, b.name));
}

/** How many items each category has (NO_CATEGORY: those without one). */
export function itemsPerCategory(
  state: ShelfState,
  categories: readonly { id: string }[],
): Map<string, number> {
  const known = idsOf(categories);
  const counts = new Map<string, number>();
  for (const item of state.items) {
    const category = categoryOf(item, known);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return counts;
}

/** The currency of the item changed last (with a price), for the next item. */
export function lastCurrency(state: ShelfState): Currency {
  const priced = state.items.filter((item) => item.price !== null);
  priced.sort((a, b) => b.updated - a.updated);
  return priced[0]?.currency ?? DEFAULT_CURRENCY;
}

/** "GEL 12.50", "₾12.50"… in the person's own style. */
export const formatPrice = (price: number, currency: Currency, locale?: string): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(price);

/** "12 Oct 2026". */
export function formatDate(date: IsoDate, locale = DATE_LOCALE): string {
  const { year, month, day } = parts(date);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** The website a link goes to, without "www." ("shop.ge"). */
export function linkHost(link: string): string {
  try {
    // Links from backups and other devices skip the form's check: only web links show.
    const url = new URL(link);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export const itemsCount = (count: number): string => `${count} ${count === 1 ? 'item' : 'items'}`;
