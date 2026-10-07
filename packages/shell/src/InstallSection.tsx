import type { AppInstall, InstallState } from "@shkriuss/pwa";
import { Button } from "@shkriuss/ui";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { m } from "./messages.ts";

export interface InstallSectionProps {
  /** How the app installs, from `appInstall()` of `@shkriuss/pwa`. */
  readonly install: AppInstall;
  /** Whether the app keeps data, which then needs taking along on iPhone and iPad; true if left out. */
  readonly keepsData?: boolean;
}

const TEXT: Readonly<Record<InstallState, (keepsData: boolean) => string>> = {
  installed: m.installed,
  promptable: m.installOffer,
  "add-to-home-screen": (keepsData) =>
    keepsData ? m.addToHomeScreen() : m.addToHomeScreenWithoutData(),
  unavailable: m.installFromMenu,
};

/**
 * The part of Settings about installing the app (architecture §9): where the browser offers to
 * install it, a button that shows the browser's prompt; on iPhone and iPad, how to add it to the
 * Home Screen, and how to take the data along, if the app keeps any; and whether it is installed.
 */
export function InstallSection({ install, keepsData = true }: InstallSectionProps) {
  const state = useSyncExternalStore(install.subscribe, install.getState);
  const [asking, setAsking] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  async function ask(): Promise<void> {
    setAsking(true);
    await install.install();
    setAsking(false);
    // The prompt is spent either way, and the button goes away; the focus goes to the section,
    // whose text says what changed.
    heading.current?.focus();
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col items-start gap-3">
      <h2 id={headingId} ref={heading} tabIndex={-1} className="text-lg font-semibold">
        {m.install()}
      </h2>
      {/* An <output>, whose role is status: screen readers read what changes. */}
      <output className="block">{TEXT[state](keepsData)}</output>
      {state === "promptable" ? (
        <Button
          variant="primary"
          isPending={asking}
          onPress={() => {
            void ask();
          }}
        >
          {m.installApp()}
        </Button>
      ) : null}
    </section>
  );
}
