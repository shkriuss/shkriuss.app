/**
 * Tally's data and rules, kept separate from the page so they're easy to test.
 * Every function returns a new state instead of changing the old one.
 */

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

/** Returns an error message for a counter name, or undefined when it's fine. */
export function nameError(name: string, state: TallyState): string | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'Enter a name for the counter.';
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `Use ${MAX_NAME_LENGTH} characters or fewer.`;
  }
  if (state.counters.some((counter) => counter.name.toLowerCase() === trimmed.toLowerCase())) {
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

export function removeCounter(state: TallyState, id: string): TallyState {
  return { counters: state.counters.filter((counter) => counter.id !== id) };
}
