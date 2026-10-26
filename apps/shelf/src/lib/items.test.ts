import { describe, expect, it } from 'vitest';
import { STARTING_CATEGORIES } from './categories.ts';
import {
  addItem,
  brandsOf,
  draftOf,
  draftProblems,
  emptyState,
  formatDate,
  formatPrice,
  isShelfState,
  itemFromDraft,
  itemsCount,
  itemsPerCategory,
  lastCurrency,
  linkHost,
  MAX_ITEMS,
  moveItems,
  NO_CATEGORY,
  NO_FILTERS,
  normalizeLink,
  parsePrice,
  removeItem,
  secondVersion,
  updateItem,
  visibleItems,
  type Item,
  type ItemDraft,
  type ShelfState,
} from './items.ts';

const draft = (changes: Partial<ItemDraft> = {}): ItemDraft => ({
  name: 'Greek yogurt',
  brand: 'Fage',
  category: 'food',
  opinion: 'love',
  price: '4.50',
  currency: 'GEL',
  shop: 'Carrefour',
  link: '',
  variant: '2%, 500 g',
  bought: '',
  notes: '',
  ...changes,
});

let clock = 1_000;
const item = (changes: Partial<ItemDraft> = {}, id = `item-${clock}`): Item =>
  itemFromDraft(draft(changes), id, (clock += 1000));
const stateOf = (...items: Item[]): ShelfState => ({ items });
const names = (items: Item[]) => items.map((entry) => entry.name);

describe('the form', () => {
  it('reads prices as people type them', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('  ')).toBeNull();
    expect(parsePrice('12')).toBe(12);
    expect(parsePrice('12.5')).toBe(12.5);
    expect(parsePrice('12,50')).toBe(12.5);
    expect(parsePrice('1 299')).toBe(1299);
    expect(parsePrice('1 299,99')).toBe(1299.99);
    expect(parsePrice(' 1 234 567 ')).toBe(1234567);
    expect(parsePrice('1 299')).toBe(1299);
    // A space that doesn't group thousands isn't a price: "12 50" was 1,250 (audit 3 F2-4).
    for (const wrong of ['abc', '12.345', '-3', '1,2,3', '12$', '2000000000', '12 50', '1 2345']) {
      expect(parsePrice(wrong), wrong).toBeUndefined();
    }
  });

  it('reads links, only to websites', () => {
    expect(normalizeLink('')).toBe('');
    expect(normalizeLink('shop.ge/item?id=4')).toBe('https://shop.ge/item?id=4');
    expect(normalizeLink(' https://www.amazon.com/dp/B0 ')).toBe('https://www.amazon.com/dp/B0');
    expect(normalizeLink('http://example.com')).toBe('http://example.com/');
    // A host and port, not a scheme.
    expect(normalizeLink('shop.ge:8080/item')).toBe('https://shop.ge:8080/item');
    // Nothing that could run code or open something else.
    for (const wrong of ['javascript:alert(1)', 'data:text/html,hi', 'mailto:a@b.ge', 'notalink']) {
      expect(normalizeLink(wrong), wrong).toBeUndefined();
    }
  });

  it('explains what to fix', () => {
    expect(draftProblems(draft())).toEqual({});
    expect(draftProblems(draft({ name: ' ', price: '12.345', link: 'javascript:x' }))).toEqual({
      name: 'Give it a name.',
      price: 'Write a price like 12.50, or leave it empty.',
      link: 'Write a web address like https://example.com, or leave it empty.',
    });
    expect(draftProblems(draft({ bought: '2026-02-30' })).bought).toBe(
      'Choose a date, or leave it empty.',
    );
  });

  it('makes an item from the form, and the form from an item', () => {
    const made = itemFromDraft(
      draft({ name: '  Greek yogurt ', link: 'fage.com', bought: '2026-10-12' }),
      'a',
      5000,
    );
    expect(made).toEqual({
      id: 'a',
      name: 'Greek yogurt',
      brand: 'Fage',
      category: 'food',
      opinion: 'love',
      price: 4.5,
      currency: 'GEL',
      shop: 'Carrefour',
      link: 'https://fage.com/',
      variant: '2%, 500 g',
      bought: '2026-10-12',
      notes: '',
      created: 5000,
      updated: 5000,
    });
    expect(draftOf(made).price).toBe('4.50');
    expect(draftOf({ ...made, price: 250 }).price).toBe('250');
    expect(itemFromDraft(draftOf(made), 'a', 9000, made)).toEqual({ ...made, updated: 9000 });
    // Unknown choices fall back to safe ones.
    const odd = itemFromDraft(draft({ opinion: 'y', currency: 'z' }), 'b', 1);
    expect([odd.opinion, odd.currency]).toEqual(['use', 'GEL']);
    expect(itemFromDraft(draft({ category: NO_CATEGORY }), 'c', 1).category).toBe(NO_CATEGORY);
  });
});

describe('changes', () => {
  it('adds, changes and removes items', () => {
    const yogurt = item();
    let state = addItem(emptyState(), yogurt);
    const shoes = item({ name: 'Running shoes', category: 'clothes' });
    state = addItem(state, shoes);
    expect(names(state.items)).toEqual(['Running shoes', 'Greek yogurt']);
    state = updateItem(state, { ...yogurt, price: 5 });
    expect(state.items[1]?.price).toBe(5);
    state = removeItem(state, shoes.id);
    expect(names(state.items)).toEqual(['Greek yogurt']);
    // Changed after it was deleted on another device: it comes back.
    expect(names(updateItem(state, shoes).items)).toEqual(['Running shoes', 'Greek yogurt']);
  });

  it('moves the items of a category that goes', () => {
    const yogurt = item({ category: 'food' });
    const shoes = item({ category: 'clothes' });
    const moved = moveItems(stateOf(yogurt, shoes), 'food', 'other');
    expect(moved.items.map((entry) => entry.category)).toEqual(['other', 'clothes']);
    // Nothing else changes, not even when it was last changed.
    expect(moved.items[0]).toEqual({ ...yogurt, category: 'other' });
    expect(moveItems(moved, 'other', NO_CATEGORY).items[0]?.category).toBe(NO_CATEGORY);
  });

  it('keeps to the most items', () => {
    const full = stateOf(...Array.from({ length: MAX_ITEMS }, (_, index) => item({}, `i${index}`)));
    expect(addItem(full, item())).toBe(full);
  });

  it('names the second version of an item changed on two devices', () => {
    const yogurt = item();
    expect(secondVersion(yogurt, 'copy')).toEqual({
      ...yogurt,
      id: 'copy',
      name: 'Greek yogurt (second version)',
    });
  });

  it('checks saved data', () => {
    expect(isShelfState(stateOf(item()))).toBe(true);
    expect(isShelfState({ items: [{ ...item(), category: 42 }] })).toBe(false);
    expect(isShelfState({ items: [{ ...item(), price: -1 }] })).toBe(false);
    expect(isShelfState({ items: [{ ...item(), bought: 'yesterday' }] })).toBe(false);
    expect(isShelfState({})).toBe(false);
  });
});

describe('finding items', () => {
  const yogurt = item({ name: 'Greek yogurt', brand: 'Fage', price: '4.50' });
  const shoes = item({
    name: 'Running shoes',
    brand: 'ASICS',
    category: 'clothes',
    opinion: 'use',
    price: '',
    variant: 'EU 43',
  });
  const cream = item({
    name: 'Face cream',
    brand: 'La Roche-Posay',
    category: 'care',
    opinion: 'want',
    price: '39',
    notes: 'For dry skin, in winter',
  });
  const skyr = item({ name: 'Skyr', brand: 'fage', price: '3' });
  const state = stateOf(yogurt, shoes, cream, skyr);
  const show = (filters: Partial<typeof NO_FILTERS>) =>
    names(visibleItems(state, { ...NO_FILTERS, ...filters }, STARTING_CATEGORIES));

  it('lists the most recently changed first', () => {
    expect(show({})).toEqual(['Skyr', 'Face cream', 'Running shoes', 'Greek yogurt']);
  });

  it('searches names, brands, shops, sizes and notes, without minding accents or case', () => {
    const search = (text: string) => show({ search: text });
    expect(search('asics 43')).toEqual(['Running shoes']);
    expect(search('WINTER')).toEqual(['Face cream']);
    expect(search('posay')).toEqual(['Face cream']);
    expect(search('carrefour')).toHaveLength(4);
    expect(search('nothing like this')).toEqual([]);
    const café = stateOf(item({ name: 'Café crème' }));
    expect(names(visibleItems(café, { ...NO_FILTERS, search: 'cafe creme' }, []))).toEqual([
      'Café crème',
    ]);
  });

  it('filters by category, how you like it, and brand (any spelling)', () => {
    expect(show({ category: 'care' })).toEqual(['Face cream']);
    expect(show({ opinion: 'love' })).toEqual(['Skyr', 'Greek yogurt']);
    expect(show({ brand: 'FAGE' })).toEqual(['Skyr', 'Greek yogurt']);
  });

  it('counts items without a category, or in one that’s gone, as having none', () => {
    const loose = stateOf(
      item({ name: 'Socks', category: NO_CATEGORY }),
      item({ name: 'Old thing', category: 'deleted-elsewhere' }),
      item({ name: 'Bread', category: 'food' }),
    );
    const filtered = (category: string) =>
      names(visibleItems(loose, { ...NO_FILTERS, category }, STARTING_CATEGORIES));
    expect(filtered(NO_CATEGORY)).toEqual(['Old thing', 'Socks']);
    expect(filtered('food')).toEqual(['Bread']);
    expect(itemsPerCategory(loose, STARTING_CATEGORIES)).toEqual(
      new Map([
        [NO_CATEGORY, 2],
        ['food', 1],
      ]),
    );
  });

  it('sorts by name, brand or price (no price last)', () => {
    const sorted = (sort: (typeof NO_FILTERS)['sort']) => show({ sort });
    expect(sorted('name')).toEqual(['Face cream', 'Greek yogurt', 'Running shoes', 'Skyr']);
    expect(sorted('brand')).toEqual(['Running shoes', 'Greek yogurt', 'Skyr', 'Face cream']);
    expect(sorted('price')).toEqual(['Skyr', 'Greek yogurt', 'Face cream', 'Running shoes']);
    // Prices in different currencies aren't compared: each currency's come together.
    const mixed = stateOf(
      item({ name: 'Lari 30', price: '30', currency: 'GEL' }, 'a'),
      item({ name: 'Dollar 20', price: '20', currency: 'USD' }, 'b'),
      item({ name: 'Lari 10', price: '10', currency: 'GEL' }, 'c'),
    );
    expect(names(visibleItems(mixed, { ...NO_FILTERS, sort: 'price' }, []))).toEqual([
      'Lari 10',
      'Lari 30',
      'Dollar 20',
    ]);
  });

  it('sorts the items without a price by name, whatever currency the form had (audit 3 F3-7)', () => {
    // A new item starts in the currency used last, so items without a price
    // have different ones once a dollar price was saved; it isn't shown.
    const noPrices = stateOf(
      item({ name: 'Apples', price: '', currency: 'USD' }, 'a'),
      item({ name: 'Bread', price: '', currency: 'GEL' }, 'b'),
      item({ name: 'Cheese', price: '', currency: 'USD' }, 'c'),
      item({ name: 'Dates', price: '', currency: 'EUR' }, 'd'),
      item({ name: 'Olive oil', price: '18', currency: 'GEL' }, 'e'),
    );
    expect(names(visibleItems(noPrices, { ...NO_FILTERS, sort: 'price' }, []))).toEqual([
      'Olive oil',
      'Apples',
      'Bread',
      'Cheese',
      'Dates',
    ]);
  });

  it('lists brands, the most loved first, spelled the usual way', () => {
    const more = stateOf(...state.items, item({ name: 'Yogurt drink', brand: 'Fage' }));
    expect(brandsOf(more)).toEqual([
      { name: 'Fage', items: 3, loved: 3 },
      { name: 'ASICS', items: 1, loved: 0 },
      { name: 'La Roche-Posay', items: 1, loved: 0 },
    ]);
    expect(brandsOf(stateOf(item({ brand: '' })))).toEqual([]);
  });
});

describe('showing items', () => {
  it('formats prices and dates in the person’s style', () => {
    expect(formatPrice(12.5, 'GEL', 'en-US')).toMatch(/^GEL\s12\.50$/);
    expect(formatPrice(1299, 'USD', 'en-US')).toBe('$1,299.00');
    expect(formatPrice(12.5, 'EUR', 'de-DE')).toMatch(/^12,50\s€$/);
    expect(formatDate('2026-10-12', 'en-GB')).toBe('12 Oct 2026');
  });

  it('suggests the currency used last', () => {
    expect(lastCurrency(emptyState())).toBe('GEL');
    const lari = item();
    const dollars = item({ currency: 'USD' });
    // Changed last, but without a price.
    const noPrice = item({ currency: 'EUR', price: '' });
    expect(lastCurrency(stateOf(lari, dollars, noPrice))).toBe('USD');
  });

  it('shows which website a link goes to', () => {
    expect(linkHost('https://www.amazon.com/dp/B0')).toBe('amazon.com');
    expect(linkHost('https://shop.ge/x')).toBe('shop.ge');
    expect(linkHost('')).toBe('');
    // A Georgian address, as typed: not as punycode (audit F3-10).
    expect(linkHost(normalizeLink('www.მაღაზია.გე/item') ?? '')).toBe('მაღაზია.გე');
    // Unless its letters could pass for another site's: Cyrillic "аррӏе" looks like "apple".
    expect(linkHost('https://xn--80ak6aa92e.com/')).toBe('xn--80ak6aa92e.com');
    // Saved data from a backup or another device: only web links are shown.
    expect(linkHost('javascript://shop.example/%0Aalert(1)')).toBe('');
    expect(linkHost('intent://shop.example/#Intent;end')).toBe('');
    expect(linkHost('file://shop.example/x')).toBe('');
  });

  it('counts items', () => {
    expect([itemsCount(0), itemsCount(1), itemsCount(2)]).toEqual(['0 items', '1 item', '2 items']);
  });
});
