import type { Observable } from "@shkriuss/data";

/** Where an observed query stands: before its first result, with its latest one, or ended. */
export type Observed<T> =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly value: T }
  | { readonly state: "failed"; readonly error: unknown };

/** An observed query as a store for React's `useSyncExternalStore`. */
export interface ObservedStore<T> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => Observed<T>;
}

const LOADING: Observed<never> = { state: "loading" };

/**
 * A store that holds the latest result of `observable`. It observes while it has a listener,
 * and keeps its result between listeners, so a component that subscribes again, as React does
 * in development, shows the result it had until a new one comes.
 */
export function observedStore<T>(observable: Observable<T>): ObservedStore<T> {
  let snapshot: Observed<T> = LOADING;
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      const subscription = observable.subscribe({
        next: (value) => {
          snapshot = { state: "ready", value };
          listener();
        },
        error: (error) => {
          snapshot = { state: "failed", error };
          listener();
        },
      });
      return () => {
        subscription.unsubscribe();
      };
    },
  };
}
