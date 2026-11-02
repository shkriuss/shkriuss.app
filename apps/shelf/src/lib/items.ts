/**
 * Shelf's data and rules, kept separate from the page so they're easy to
 * test. Every function returns a new state instead of changing the old one.
 *
 * An item is something you buy or use: food, clothes, tech, personal care…
 * with its brand, how you like it, its price, where to get it and a link.
 */
import { isIsoDate, parts, type IsoDate } from '@shkriuss/dates';
import { secondVersionName } from '@shkriuss/sync';
import { compareText, cutChanged, cutToLength, foldText } from '@shkriuss/ui/text';
import {
  decimalText,
  formatMoney,
  parseDecimal,
  roundDecimal,
  whichAmount,
} from '@shkriuss/ui/numbers';
import { DATE_LOCALE } from '@shkriuss/ui/locale';
import { readableHost } from './hosts.ts';

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
 * A price as typed, read as the money apps read amounts (parseDecimal, audit
 * 5 F3-10): "12.50" and "12,50" are 12.5 everywhere, "1,299.50" in English
 * and "1.299,50" in German are 1299.5, "1 299" is 1299, and any script's
 * digits count ("١٢" is 12). Kept to the cent: "1.500" in French, which
 * could be 1500 or 1.5, isn't read (`cents`), and "12.345" isn't a price.
 * Null when empty; undefined when it isn't a price, or is below 0 or over
 * MAX_PRICE (priceProblem says what's wrong). `locale`: how the person
 * writes numbers (the browser's own when it's left out).
 */
export function parsePrice(text: string, locale?: string): number | null | undefined {
  const price = parseDecimal(text, locale, { cents: true });
  if (price === null) return null;
  if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) return undefined;
  return roundDecimal(price, 2) === price ? price : undefined;
}

/** What's wrong with a typed price, or null when it's one (or empty). */
export function priceProblem(text: string, locale?: string): string | null {
  if (parsePrice(text, locale) !== undefined) return null;
  const amount = parseDecimal(text, locale, { cents: true });
  if (amount !== null && Number.isFinite(amount) && amount > MAX_PRICE) {
    return `A price can be up to ${MAX_PRICE.toLocaleString('en')}.`;
  }
  // "1.500" in French: 1500, or 1.5? Asked which, as in the money apps.
  return whichAmount(text, locale) ?? 'Write a price like 12.50, or leave it empty.';
}

/** Whether `text` is longer than `max` characters as people see them (as Safari's boxes count). */
const longerThan = (text: string, max: number): boolean => cutToLength(text, max) !== text;

/** A typed link with "https://" added when it has no scheme ("shop.ge:8080/x" has none: a dot makes it a host and port). */
const withHttps = (typed: string): string =>
  /^[a-z][a-z\d+-]*:/i.test(typed) ? typed : `https://${typed}`;

/**
 * A link as typed, trimmed, with "https://" added when it has no scheme:
 * "shop.ge/item" becomes "https://shop.ge/item". It's kept as written, so
 * the form shows it that way when the item is opened again: a browser's own
 * form of it ("xn--…" names, "%E1%83…" for letters in other scripts) is for
 * the link itself, in the page's anchor (audit 5 F3-3). "" when empty;
 * undefined when it isn't a web address (only http and https are allowed, so
 * a link can never run code: audit C-4), or longer than the box takes once
 * "https://" is added (what's saved has to fit the box too, or the item could
 * never be saved again).
 */
export function normalizeLink(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  const withScheme = withHttps(trimmed);
  if (longerThan(withScheme, LIMITS.link)) return undefined;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (!url.hostname.includes('.')) return undefined;
    return withScheme;
  } catch {
    return undefined;
  }
}

/** What's wrong with a typed link, or null when it's a web address (or empty). */
export function linkProblem(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed !== '' && longerThan(withHttps(trimmed), LIMITS.link)) {
    return `That link is too long: up to ${LIMITS.link.toLocaleString('en')} characters, with the "https://" added to one typed without it.`;
  }
  if (normalizeLink(text) === undefined) {
    return 'Write a web address like https://example.com, or leave it empty.';
  }
  return null;
}

/** What's wrong with the form, by field (empty when it can be saved). */
export function draftProblems(
  draft: ItemDraft,
  locale?: string,
): Partial<Record<DraftField, string>> {
  const problems: Partial<Record<DraftField, string>> = {};
  if (draft.name.trim() === '') problems.name = 'Give it a name.';
  const price = priceProblem(draft.price, locale);
  if (price !== null) problems.price = price;
  const link = linkProblem(draft.link);
  if (link !== null) problems.link = link;
  if (draft.bought !== '' && !isIsoDate(draft.bought)) {
    problems.bought = 'Choose a date, or leave it empty.';
  }
  return problems;
}

/**
 * Text cut to `max` characters as people see them (as Safari's text boxes
 * count): what a box lets in is never cut on saving, nor an emoji in half
 * (audit 4 F3-4). Text the item has now (`saved`) stays as it is: another
 * device may count its characters differently (audit 7 F1-1).
 */
const cut = (text: string, max: number, saved?: string): string =>
  cutChanged(text.trim(), max, saved);

/**
 * The item a (checked) draft describes. Keeps `created` from the item it
 * changes. `locale`: how the person writes numbers (see parsePrice).
 */
export function itemFromDraft(
  draft: ItemDraft,
  id: string,
  now: number,
  existing?: Item,
  locale?: string,
): Item {
  return {
    id,
    name: cut(draft.name, LIMITS.name, existing?.name),
    brand: cut(draft.brand, LIMITS.brand, existing?.brand),
    category: draft.category,
    opinion: oneOf(draft.opinion, OPINIONS) ? draft.opinion : 'use',
    price: parsePrice(draft.price, locale) ?? null,
    currency: oneOf(draft.currency, CURRENCIES) ? draft.currency : DEFAULT_CURRENCY,
    shop: cut(draft.shop, LIMITS.shop, existing?.shop),
    link: normalizeLink(draft.link) ?? '',
    variant: cut(draft.variant, LIMITS.variant, existing?.variant),
    bought: isIsoDate(draft.bought) ? draft.bought : null,
    notes: cut(draft.notes, LIMITS.notes, existing?.notes),
    created: existing?.created ?? now,
    updated: now,
  };
}

/**
 * A price as the form shows it: 4.5 as "4.50", whole prices without
 * decimals ("250"). One the form can't save (from an edited backup, say) is
 * shown as it is, never rounded or with an exponent, so saving the form
 * doesn't change it without a word: it says what's wrong (audit 6).
 */
function priceText(price: number): string {
  if (price > MAX_PRICE || roundDecimal(price, 2) !== price) return decimalText(price, 'en');
  return Number.isInteger(price) ? String(price) : price.toFixed(2);
}

/** The form's text for an item, to edit it. */
export function draftOf(item: Item): ItemDraft {
  return {
    name: item.name,
    brand: item.brand,
    category: item.category,
    opinion: item.opinion,
    price: item.price === null ? '' : priceText(item.price),
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
 * Characters as people see them, to cut between. Firefox before 125 can't
 * tell them apart: there, each code point is one (an emoji's two halves
 * still stay together), as in cutToLength.
 */
const characters =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('en', { granularity: 'grapheme' })
    : null;

/**
 * The longest start of `text` at most `max` long (as JavaScript counts),
 * never cut in the middle of a character as people see it: an emoji (also
 * a family, a flag or a skin tone), or a letter with its accent. As Notes'
 * fitText.
 */
function fitText(text: string, max: number): string {
  if (text.length <= max) return text;
  const parts = characters ? characters.segment(text) : [...text].map((segment) => ({ segment }));
  let end = 0;
  for (const { segment } of parts) {
    if (end + segment.length > max) break;
    end += segment.length;
  }
  return text.slice(0, end);
}

/** How much of a name fits before packages/sync adds " (second version)". */
const SECOND_VERSION_ROOM = LIMITS.name - (secondVersionName('x', LIMITS.name).length - 'x'.length);

/**
 * An item changed on two devices at once: this device's version, kept as a
 * second item next to the other device's (packages/sync, conflictCopy). A
 * long name is cut between whole characters first, as Notes does: cut by
 * code points, a name of flags, families, skin tones or letters with their
 * accents ended in half a character (audit 5 F3-2).
 */
export const secondVersion = (item: Item, id: string): Item => ({
  ...item,
  id,
  name: secondVersionName(fitText(item.name.trim(), SECOND_VERSION_ROOM), LIMITS.name),
});

// ---------- Showing them ----------

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
 * for (in the name, brand, shop, size, notes and the category's name: audit
 * 5 F3-10), sorted. `categories` are the ones that exist now.
 */
export function visibleItems(
  state: ShelfState,
  filters: Filters,
  categories: readonly { id: string; name: string }[],
): Item[] {
  const known = idsOf(categories);
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const words = foldText(filters.search).split(/\s+/).filter(Boolean);
  const brand = filters.brand === null ? null : foldText(filters.brand);
  const sorters: Record<Sort, (a: Item, b: Item) => number> = {
    recent: (a, b) => b.updated - a.updated,
    name: (a, b) => byText(a.name, b.name),
    brand: (a, b) =>
      Number(a.brand === '') - Number(b.brand === '') ||
      byText(a.brand, b.brand) ||
      byText(a.name, b.name),
    // Without a price: last, by name (their currency isn't shown, so it
    // doesn't count: audit 3 F3-7). Prices in different currencies can't be
    // compared (no exchange rates), so each currency's come together.
    price: (a, b) =>
      Number(a.price === null) - Number(b.price === null) ||
      (a.price === null || b.price === null
        ? 0
        : byText(a.currency, b.currency) || a.price - b.price) ||
      byText(a.name, b.name),
  };
  return state.items
    .filter((item) => {
      if (filters.category !== 'all' && categoryOf(item, known) !== filters.category) return false;
      if (filters.opinion !== 'all' && item.opinion !== filters.opinion) return false;
      if (brand !== null && foldText(item.brand) !== brand) return false;
      const category = names.get(categoryOf(item, known)) ?? '';
      const text = foldText(
        [item.name, item.brand, item.shop, item.variant, item.notes, category].join('\n'),
      );
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
    const key = foldText(item.brand);
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
  formatMoney(price, currency, { locale });

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

/** A saved link read as a web address on its own, or null when it isn't one. */
function webLink(link: string): URL | null {
  try {
    // Links from backups and other devices skip the form's check: only web links show.
    const url = new URL(link);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * The website a link goes to, without "www." ("shop.ge"), in its own
 * letters when that's safe ("მაღაზია.გე", not "xn--lodaaxko2f.xn--node").
 */
export function linkHost(link: string): string {
  const url = webLink(link);
  return url ? readableHost(url.hostname.replace(/^www\./, '')) : '';
}

/**
 * The address the page's link opens: the saved link as linkHost reads it,
 * written out in full. Put in the page as typed, "https:shop.ge/item" (no
 * "//") was read against Shelf's own address, so the card said "shop.ge"
 * but opened a page on Shelf (audit 6 F3-2). "" when it isn't a web link.
 */
export const linkHref = (link: string): string => webLink(link)?.href ?? '';

export const itemsCount = (count: number): string => `${count} ${count === 1 ? 'item' : 'items'}`;
