import type { AppStorage, StorageStatus } from "@shkriuss/pwa";
import { Button } from "@shkriuss/ui";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { m } from "./data-messages.ts";

export interface StorageSectionProps {
  /** The app's storage, from `appStorage()` of `@shkriuss/pwa`. */
  readonly storage: AppStorage;
}

/** What the user reads about whether the browser keeps the data. */
function keptText(persistence: StorageStatus["persistence"], refused: boolean): string {
  if (persistence === "persisted") {
    return m.kept();
  }
  if (persistence === "unknown") {
    return m.keptUnknown();
  }
  return refused ? m.notKept() : m.mayDelete();
}

/**
 * The part of Settings about the app's data on this device (architecture §7): how much the app
 * stores, whether the browser keeps it until the user deletes it, and a button that asks the
 * browser to keep it. Firefox then asks the user; Chromium and Safari decide by themselves.
 */
export function StorageSection({ storage }: StorageSectionProps) {
  const status = useSyncExternalStore(storage.subscribe, storage.getStatus);
  const [asking, setAsking] = useState(false);
  const [refused, setRefused] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  useEffect(() => {
    // What the app stores changes as it is used: the section shows it as it is now.
    void storage.refresh();
  }, [storage]);

  async function keep(): Promise<void> {
    setAsking(true);
    const kept = await storage.requestPersistence();
    setAsking(false);
    setRefused(!kept);
    if (kept) {
      // The button goes away; the focus goes to the section, whose text says what changed.
      heading.current?.focus();
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col items-start gap-3">
      <h2 id={headingId} ref={heading} tabIndex={-1} className="text-lg font-semibold">
        {m.storage()}
      </h2>
      <p>{status.usage === undefined ? m.usageUnknown() : m.usage(status.usage)}</p>
      {/* An <output>, whose role is status: screen readers read what changes. */}
      <output className="block">{keptText(status.persistence, refused)}</output>
      {status.persistence === "best-effort" ? (
        <Button
          isPending={asking}
          onPress={() => {
            void keep();
          }}
        >
          {m.keepData()}
        </Button>
      ) : null}
    </section>
  );
}
