/**
 * What an app's page says once it's nearly full, the same way in every app
 * that keeps a lot of one thing (Budget's entries, Habits' check marks,
 * Repairs' repairs, Trades' trades): how many more fit, and how to make room
 * (audit 4 J-11).
 *
 *   roomNote({ app: 'Repairs', count, most: 2000, one: 'repair', many: 'repairs',
 *     makeRoom: 'To make room, use “Delete a year…”, below.' })
 */

export interface RoomNote {
  /** The app's name: "Budget". */
  app: string;
  /** How many it keeps now. */
  count: number;
  /** The most it keeps. */
  most: number;
  /** What it keeps, one and more: "entry", "entries". */
  one: string;
  many: string;
  /** Said after "it keeps up to 2,000", like ", open and closed". */
  also?: string;
  /** How to make room: "To make room, use “Delete a year…”, below." */
  makeRoom: string;
  locale?: string | undefined;
}

/** The note once over 90% of `most` is kept; null until then. */
export function roomNote(note: RoomNote): string | null {
  const { app, count, most, one, many, also = '', makeRoom, locale } = note;
  if (count <= most * 0.9) return null;
  const left = most - count;
  const number = new Intl.NumberFormat(locale);
  const start =
    left > 0
      ? `${app} is nearly full: there’s room for ${number.format(left)} more ${left === 1 ? one : many} (it keeps up to ${number.format(most)}${also}).`
      : `${app} is full: it keeps up to ${number.format(most)} ${many}${also}.`;
  return `${start} ${makeRoom}`;
}
