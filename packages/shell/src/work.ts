import type { RefObject } from "react";

/**
 * The cleanup of an effect that stops a dialog's work, the `AbortController` in `work`, when the
 * dialog goes away without closing, as when the user navigates elsewhere: React fires no close
 * event then, so the work stops here, with its worker (backup format §3.1).
 *
 * It is made here, outside any render, on purpose: a cleanup lives as long as the component, and
 * a closure keeps alive every variable of the scope it was made in that any closure there uses.
 * Made in the render, it would keep the first render's state, the generated passphrase among it,
 * long after the backup was made. Use it as `useEffect(() => stopOnUnmount(work), [])`.
 */
export function stopOnUnmount(work: RefObject<AbortController | undefined>): () => void {
  return () => {
    work.current?.abort();
    work.current = undefined;
  };
}
