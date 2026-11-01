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
  LIMITS,
  linkHost,
  linkHref,
  linkProblem,
  MAX_ITEMS,
  MAX_PRICE,
  moveItems,
  NO_CATEGORY,
  NO_FILTERS,
  normalizeLink,
  parsePrice,
  priceProblem,
  removeItem,
  secondVersion,
  updateItem,
  visibleItems,
  type Item,
  type ItemDraft,
  type ShelfState,
} from './items.ts';

/** Numbers in tests: the same on a computer set to any language (audit 3 J-5). */
const EN = 'en-US';

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
    expect(parsePrice('', EN)).toBeNull();
    expect(parsePrice('  ', EN)).toBeNull();
    expect(parsePrice('12', EN)).toBe(12);
    expect(parsePrice('12.5', EN)).toBe(12.5);
    expect(parsePrice('12,50', EN)).toBe(12.5);
    expect(parsePrice('1 299', EN)).toBe(1299);
    expect(parsePrice('1 299,99', EN)).toBe(1299.99);
    expect(parsePrice(' 1 234 567 ', EN)).toBe(1234567);
    expect(parsePrice('1 299', EN)).toBe(1299);
    expect(parsePrice('0', EN)).toBe(0);
    expect(parsePrice('0012.5', EN)).toBe(12.5);
    expect(parsePrice(String(MAX_PRICE), EN)).toBe(MAX_PRICE);
    // A space that doesn't group thousands isn't a price: "12 50" was 1,250 (audit 3 F2-4).
    for (const wrong of ['abc', '12.345', '-3', '1,2,3', '12$', '2000000000', '12 50', '1 2345']) {
      expect(parsePrice(wrong, EN), wrong).toBeUndefined();
    }
  });

  it('reads prices as the money apps read amounts (audit 5 F3-10)', () => {
    // Written the way the person's language writes numbers, in its digits too.
    expect(parsePrice('1,299.50', EN)).toBe(1299.5);
    expect(parsePrice('1.299,50', 'de-DE')).toBe(1299.5);
    expect(parsePrice('1,500', EN)).toBe(1500);
    expect(parsePrice('1,500', 'de-DE')).toBe(1.5);
    expect(parsePrice('١٢', EN)).toBe(12);
    expect(parsePrice('１２.５', EN)).toBe(12.5);
    expect(parsePrice('+12', EN)).toBe(12);
    // "1.500" in French: 1500, or 1.5? Asked which, instead of guessing.
    expect(parsePrice('1.500', 'fr-FR')).toBeUndefined();
    expect(priceProblem('1.500', 'fr-FR')).toBe('Enter 1500 or 1,5 to show which you mean.');
    expect(priceProblem('1,500', EN)).toBeNull();
    expect(priceProblem('', EN)).toBeNull();
    // Over the limit is said as such, not as "not a price".
    expect(priceProblem('2000000000', EN)).toBe('A price can be up to 1,000,000,000.');
    expect(priceProblem('1,000,000,000.01', EN)).toBe('A price can be up to 1,000,000,000.');
    for (const wrong of ['abc', '12.345', '-3', '12 50']) {
      expect(priceProblem(wrong, EN), wrong).toBe('Write a price like 12.50, or leave it empty.');
    }
  });

  it('reads links, only to websites', () => {
    expect(normalizeLink('')).toBe('');
    expect(normalizeLink('shop.ge/item?id=4')).toBe('https://shop.ge/item?id=4');
    expect(normalizeLink(' https://www.amazon.com/dp/B0 ')).toBe('https://www.amazon.com/dp/B0');
    expect(normalizeLink('http://example.com')).toBe('http://example.com');
    // A host and port, not a scheme.
    expect(normalizeLink('shop.ge:8080/item')).toBe('https://shop.ge:8080/item');
    expect(normalizeLink('shop.ge/#top')).toBe('https://shop.ge/#top');
    expect(normalizeLink('HTTPS://SHOP.GE/X')).toBe('HTTPS://SHOP.GE/X');
    expect(normalizeLink('192.168.1.1/admin')).toBe('https://192.168.1.1/admin');
    // Nothing that could run code or open something else (audit C-4).
    for (const wrong of [
      'javascript:alert(1)',
      'data:text/html,hi',
      'mailto:a@b.ge',
      'notalink',
      'localhost/x',
      'user:pw@shop.ge/x',
      'https://',
    ]) {
      expect(normalizeLink(wrong), wrong).toBeUndefined();
    }
  });

  it('keeps a link as it was typed, so the form shows it that way (audit 5 F3-3)', () => {
    // Before, it was saved as the browser writes it: letters in other
    // scripts as "%E1%83…", and a name like "მაღაზია.გე" as "xn--…".
    const georgian = 'https://ka.wikipedia.org/wiki/თბილისი';
    expect(normalizeLink(georgian)).toBe(georgian);
    const typed = 'მაღაზია.გე/პროდუქტი';
    const made = itemFromDraft(draft({ link: typed }), 'a', 1);
    expect(made.link).toBe(`https://${typed}`);
    expect(draftOf(made).link).toBe(`https://${typed}`);
    expect(linkHost(made.link)).toBe('მაღაზია.გე');
    // Spaces stay too: the browser encodes them when the link is opened.
    expect(normalizeLink('shop.ge/my product')).toBe('https://shop.ge/my product');
    expect(new URL(normalizeLink('shop.ge/my product') ?? '').href).toBe(
      'https://shop.ge/my%20product',
    );
    // A link that fits the box is never refused, however the browser would
    // write it: 260 Georgian letters were "too long" at 1,940 characters.
    const long = `https://ka.wikipedia.org/wiki/${'თბილისის_მეტროპოლიტენი_'.repeat(10)}`;
    expect(normalizeLink(long)).toBe(long);
    expect(draftProblems(draft({ link: long }))).toEqual({});
    const atLimit = `https://example.com/${'a'.repeat(LIMITS.link - 20)}`;
    expect(atLimit).toHaveLength(LIMITS.link);
    expect(normalizeLink(atLimit)).toBe(atLimit);
    // Typed without "https://", which is added: what's saved has to fit the
    // box too, or the item could never be saved again from its form.
    const noScheme = `example.com/${'a'.repeat(LIMITS.link - 20)}`;
    expect(normalizeLink(noScheme)).toBe(`https://${noScheme}`);
    expect(`https://${noScheme}`).toHaveLength(LIMITS.link);
    const tooLongWithScheme = `example.com/${'a'.repeat(LIMITS.link - 15)}`;
    expect(normalizeLink(tooLongWithScheme)).toBeUndefined();
    // Longer than the box takes: said so, not "not a web address".
    const tooLong = `https://example.com/${'a'.repeat(LIMITS.link)}`;
    expect(normalizeLink(tooLong)).toBeUndefined();
    const TOO_LONG =
      'That link is too long: up to 2,000 characters, with the "https://" added to one typed without it.';
    expect(linkProblem(tooLong)).toBe(TOO_LONG);
    expect(linkProblem(tooLongWithScheme)).toBe(TOO_LONG);
    expect(linkProblem(`shop.ge/${'🇬🇪'.repeat(LIMITS.link - 16)}`)).toBeNull();
    expect(linkProblem('javascript:x')).toBe(
      'Write a web address like https://example.com, or leave it empty.',
    );
  });

  it('explains what to fix', () => {
    expect(draftProblems(draft(), EN)).toEqual({});
    expect(draftProblems(draft({ name: ' ', price: '12.345', link: 'javascript:x' }), EN)).toEqual({
      name: 'Give it a name.',
      price: 'Write a price like 12.50, or leave it empty.',
      link: 'Write a web address like https://example.com, or leave it empty.',
    });
    expect(draftProblems(draft({ bought: '2026-02-30' }), EN).bought).toBe(
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
      link: 'https://fage.com',
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

  it('keeps all a box let in, counted as Safari counts (audit 4 F3-4)', () => {
    // Safari's maxlength counts characters as people see them: its name box
    // takes 150 flags (300 in JavaScript), and its notes box 500 of these.
    const flags = '🇬🇪'.repeat(150);
    const notes = 'Great 👍🏽 '.repeat(500).trim();
    const made = itemFromDraft(draft({ name: flags, notes }), 'a', 1);
    expect(made.name).toBe(flags);
    expect(made.notes).toBe(notes);
    // Never half an emoji.
    expect(itemFromDraft(draft({ brand: `${'b'.repeat(99)}😀😀` }), 'b', 1).brand).toBe(
      `${'b'.repeat(99)}😀`,
    );
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
    expect(secondVersion(item({ name: 't'.repeat(LIMITS.name) }), 'copy').name).toBe(
      `${'t'.repeat(LIMITS.name - 17)} (second version)`,
    );
  });

  it('cuts a long name for the second version between whole characters (audit 5 F3-2)', () => {
    // A name is 200 characters as people see them, up to 3,200 as JavaScript
    // counts: cut by code points, it ended in half a flag, a family without
    // its last member, a thumb without its skin tone, or "e" without its accent.
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    for (const character of ['🇬🇪', '👨‍👩‍👧', '👍🏽', 'é']) {
      const copy = secondVersion(item({ name: character.repeat(LIMITS.name) }), 'copy');
      expect(copy.name, character).toMatch(/ \(second version\)$/);
      expect(copy.name.length, character).toBeLessThanOrEqual(LIMITS.name);
      const base = copy.name.replace(/ \(second version\)$/, '');
      const seen = [...segmenter.segment(base)].map((part) => part.segment);
      expect(
        seen.every((part) => part === character),
        character,
      ).toBe(true);
      expect(seen.length, character).toBeGreaterThan(20);
      // It passes the app's own checks unchanged.
      expect(itemFromDraft(draftOf(copy), 'copy', 1).name, character).toBe(copy.name);
    }
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

  it('searches names, brands, shops, sizes, notes and categories, without minding accents or case', () => {
    const search = (text: string) => show({ search: text });
    expect(search('asics 43')).toEqual(['Running shoes']);
    expect(search('WINTER')).toEqual(['Face cream']);
    expect(search('posay')).toEqual(['Face cream']);
    expect(search('carrefour')).toHaveLength(4);
    expect(search('nothing like this')).toEqual([]);
    // The category's name too, as the badge shows it (audit 5 F3-10); not
    // one that's gone, which the badge doesn't show.
    expect(search('personal care')).toEqual(['Face cream']);
    expect(search('food')).toEqual(['Skyr', 'Greek yogurt']);
    expect(names(visibleItems(state, { ...NO_FILTERS, search: 'food' }, []))).toEqual([]);
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

  it('opens the website it shows, also for a link typed without "//" (audit 6 F3-2)', () => {
    // On the page, the browser reads a link against Shelf's own address: as
    // typed, "https:shop.ge/item" opened Shelf's own "shop.ge/item" page.
    const shelf = 'https://shelf.shkriuss.app/';
    for (const typed of ['https:shop.ge/item', 'https:/shop.ge/item', 'HTTPS:shop.ge/item']) {
      const saved = normalizeLink(typed) ?? '';
      expect(saved, typed).toBe(typed);
      expect(linkHost(saved), typed).toBe('shop.ge');
      expect(new URL(linkHref(saved), shelf).href, typed).toBe('https://shop.ge/item');
    }
    expect(linkHref('https://www.amazon.com/dp/B0')).toBe('https://www.amazon.com/dp/B0');
    expect(linkHref('http://shop.ge')).toBe('http://shop.ge/');
    // A Georgian address: the browser's own form of it, for the browser.
    expect(linkHref('https://მაღაზია.გე/item')).toBe('https://xn--lodaaxko2f.xn--node/item');
    // Saved data from a backup or another device: only web links.
    expect(linkHref('')).toBe('');
    expect(linkHref('javascript:alert(1)')).toBe('');
    expect(linkHref('shop.ge/item')).toBe('');
  });

  it('counts items', () => {
    expect([itemsCount(0), itemsCount(1), itemsCount(2)]).toEqual(['0 items', '1 item', '2 items']);
  });
});
