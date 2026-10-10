/**
 * The loading of something that an app loads on demand, after its first page (ADR 0018), such
 * as a component of `later.ts`. It starts once and keeps its promise, which a component can
 * give to `use()` of React; a loading that failed stays failed, so that the component finds
 * that, and its error boundary shows it, rather than loading again at each render. Only
 * `retry()`, and so `load()`, tries again: a route's loader, and the user's next action.
 */
export interface Loading<T> {
  /** The loading, started if it was not: the same promise until `retry()`. */
  readonly start: () => Promise<T>;
  /** Lets a loading that failed be tried again, by the next `start()`. */
  readonly retry: () => void;
  /** Loads, trying again after a failure: for a route's loader. */
  readonly load: () => Promise<T>;
  /** What loaded, once it has. */
  readonly loaded: () => T | undefined;
}

/** The loading of what `load` gives, which `load` is asked for once, until it fails. */
export function loading<T>(load: () => Promise<T>): Loading<T> {
  let value: T | undefined;
  let promise: Promise<T> | undefined;
  let failed = false;
  const start = (): Promise<T> => {
    if (promise === undefined) {
      failed = false;
      promise = load().then((loaded) => {
        value = loaded;
        return loaded;
      });
      promise.catch(() => {
        failed = true;
      });
    }
    return promise;
  };
  const retry = (): void => {
    if (failed) {
      promise = undefined;
    }
  };
  return {
    start,
    retry,
    load: async () => {
      retry();
      return start();
    },
    loaded: () => value,
  };
}
