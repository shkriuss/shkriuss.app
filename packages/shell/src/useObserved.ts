import type { Observable } from "@shkriuss/data";
import { useMemo, useSyncExternalStore } from "react";
import { type Observed, observedStore } from "./observed.ts";

/**
 * The latest result of an observed query, such as one of `db.observe()`, which re-renders the
 * component at each new result. Create the observable once, with `useMemo`, so that a render
 * does not start a new observation:
 *
 * ```tsx
 * const notes = useObserved(useMemo(() => db.observe((reader) => reader.list("notes")), [db]));
 * if (notes.state === "ready") return <NoteList notes={notes.value} />;
 * ```
 */
export function useObserved<T>(observable: Observable<T>): Observed<T> {
  const store = useMemo(() => observedStore(observable), [observable]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
