import type { Observable, Observer } from "@shkriuss/data";
import { describe, expect, it, vi } from "vitest";
import { observedStore } from "./observed.ts";

/** An observable whose results the test sends, and which counts its observers. */
function fakeObservable<T>(): {
  observable: Observable<T>;
  observers: Set<Observer<T>>;
  unsubscribe: ReturnType<typeof vi.fn<() => void>>;
} {
  const observers = new Set<Observer<T>>();
  const unsubscribe = vi.fn<() => void>();
  return {
    observers,
    unsubscribe,
    observable: {
      subscribe: (observer) => {
        observers.add(observer);
        return {
          unsubscribe: () => {
            observers.delete(observer);
            unsubscribe();
          },
        };
      },
    },
  };
}

describe("observedStore", () => {
  it("is loading until the first result, then holds each new one", () => {
    const { observable, observers } = fakeObservable<string[]>();
    const store = observedStore(observable);
    expect(store.getSnapshot()).toStrictEqual({ state: "loading" });
    const listener = vi.fn<() => void>();
    store.subscribe(listener);
    for (const observer of observers) {
      observer.next(["Milk"]);
    }
    expect(store.getSnapshot()).toStrictEqual({ state: "ready", value: ["Milk"] });
    for (const observer of observers) {
      observer.next(["Milk", "Eggs"]);
    }
    expect(store.getSnapshot()).toStrictEqual({ state: "ready", value: ["Milk", "Eggs"] });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps the same snapshot until a new result, as useSyncExternalStore needs", () => {
    const { observable, observers } = fakeObservable<number>();
    const store = observedStore(observable);
    store.subscribe(() => undefined);
    for (const observer of observers) {
      observer.next(1);
    }
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("holds the error that ended the observation", () => {
    const { observable, observers } = fakeObservable<number>();
    const store = observedStore(observable);
    const listener = vi.fn<() => void>();
    store.subscribe(listener);
    const error = new Error("The database was closed.");
    for (const observer of observers) {
      observer.error(error);
    }
    expect(store.getSnapshot()).toStrictEqual({ state: "failed", error });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("observes only while it has a listener, and keeps its result in between", () => {
    const { observable, observers, unsubscribe } = fakeObservable<number>();
    const store = observedStore(observable);
    const stop = store.subscribe(() => undefined);
    expect(observers.size).toBe(1);
    for (const observer of observers) {
      observer.next(7);
    }
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(observers.size).toBe(0);
    // React subscribes again, as it does in development: the result stays until a new one.
    store.subscribe(() => undefined);
    expect(store.getSnapshot()).toStrictEqual({ state: "ready", value: 7 });
    expect(observers.size).toBe(1);
  });
});
