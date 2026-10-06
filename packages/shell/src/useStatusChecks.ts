import { useEffect, useEffectEvent } from "react";
import type { BackupStatus, BackupStatusStore } from "./backup-status.ts";

/**
 * Reads the backup status when the component appears and whenever the app comes back into view,
 * and gives each reading to `check`: the moments when a banner may appear, so that none appears
 * in the middle of a task.
 */
export function useStatusChecks(
  store: BackupStatusStore,
  check: (status: BackupStatus) => void,
): void {
  const onStatus = useEffectEvent(check);
  useEffect(() => {
    let mounted = true;
    async function read(): Promise<void> {
      await store.refresh();
      const status = store.getStatus();
      if (mounted && status !== undefined) {
        onStatus(status);
      }
    }
    function onVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        void read();
      }
    }
    void read();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [store]);
}
