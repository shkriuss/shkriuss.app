/**
 * Tally's data and rules, kept separate from the page so they're easy to test.
 * Every function returns a new state instead of changing the old one.
 */
import { secondVersionName } from '@shkriuss/sync';
import { cutToLength, foldText } from '@shkriuss/ui/text';

export interface Counter {
  id: string;
  name: string;
  count: number;
}

export interface TallyState {
  counters: Counter[];
}

export const MAX_NAME_LENGTH = 60;
export const MAX_COUNTERS = 100;

export const emptyState = (): TallyState => ({ counters: [] });

function isCounter(value: unknown): value is Counter {
  if (typeof value !== 'object' || value === null) return false;
  const { id, name, count } = value as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    typeof name === 'string' &&
    typeof count === 'number' &&
    Number.isSafeInteger(count) &&
    count >= 0
  );
}

/** True when saved data has the shape Tally expects. */
export function isTallyState(value: unknown): value is TallyState {
  if (typeof value !== 'object' || value === null) return false;
  const { counters } = value as Record<string, unknown>;
  return Array.isArray(counters) && counters.every(isCounter);
}

/**
 * Whether a name fits (MAX_NAME_LENGTH), counted as text boxes count their
 * maxlength on an iPhone: a flag, a family emoji or a letter with its
 * accent is one character, so what a full box holds is never refused on
 * saving (cutToLength, audit 5 F2-3).
 */
const fits = (name: string): boolean => cutToLength(name, MAX_NAME_LENGTH) === name;

/** Returns an error message for a counter name, or undefined when it's fine. */
export function nameError(name: string, state: TallyState): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Enter a name for the counter.';
  if (!fits(trimmed)) {
    return `Use ${MAX_NAME_LENGTH} characters or fewer.`;
  }
  // The same name without minding case or accents ("Café" is "Cafe"), as in
  // the other apps (foldText, audit 3 J-12).
  if (state.counters.some((counter) => foldText(counter.name) === foldText(trimmed))) {
    return 'You already have a counter with that name.';
  }
  if (state.counters.length >= MAX_COUNTERS) {
    return `You can have up to ${MAX_COUNTERS} counters.`;
  }
  return undefined;
}

export function addCounter(state: TallyState, name: string, id: string): TallyState {
  if (nameError(name, state)) return state;
  return { counters: [...state.counters, { id, name: name.trim(), count: 0 }] };
}

/** Adds `delta` to a counter. Counts never go below zero. */
export function changeCount(state: TallyState, id: string, delta: number): TallyState {
  return {
    counters: state.counters.map((counter) =>
      counter.id === id
        ? {
            ...counter,
            count: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, counter.count + delta)),
          }
        : counter,
    ),
  };
}

export function resetCounter(state: TallyState, id: string): TallyState {
  return {
    counters: state.counters.map((counter) =>
      counter.id === id ? { ...counter, count: 0 } : counter,
    ),
  };
}

/**
 * A counter changed on two devices at once: this device's version, kept as
 * its own counter next to the other device's (packages/sync, conflictCopy).
 */
export const secondVersion = (counter: Counter, id: string): Counter => ({
  ...counter,
  id,
  name: secondVersionName(counter.name, MAX_NAME_LENGTH),
});

/**
 * How the counters sync (packages/sync, syncedStore): a counter changed on
 * two devices before they sync is kept twice, the same count too. Water at
 * 5, counted once on each device, is 6 on both: two glasses, which were
 * one counter of 6 (audit 4 F2-3). But 0 on both is one change: reset on
 * both devices, or counted down to 0 on both, where it can't go lower.
 */
export const COUNTER_SYNC = {
  conflictCopy: (mine: Counter): Counter => secondVersion(mine, crypto.randomUUID()),
  keepSame: (counter: Counter): boolean => counter.count > 0,
};

export function removeCounter(state: TallyState, id: string): TallyState {
  return { counters: state.counters.filter((counter) => counter.id !== id) };
}
