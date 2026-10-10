import { Button, Dialog, Link } from "@shkriuss/ui";
import { useEffect, useId, useRef, useState } from "react";
import { Licenses } from "./Licenses.tsx";
import { SECURITY_URL, SOURCE_URL } from "./links.ts";
import { m } from "./messages.ts";

export interface AboutSectionProps {
  /** The app's name. */
  readonly name: string;
  /** What the app does, in a sentence. */
  readonly description: string;
  /** Whether the app keeps data, which then stays on the device; true if left out. */
  readonly keepsData?: boolean;
}

/**
 * The licenses of the software of others that the app includes, in a dialog, from the build's
 * `/licenses.txt`, which the service worker keeps offline.
 */
function LicensesButton() {
  const [isOpen, setOpen] = useState(false);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The dialog opens at the top of the text, which arrow keys then scroll, rather than at its
    // button below the text, where the browser would put the focus.
    if (isOpen) {
      content.current?.focus();
    }
  }, [isOpen]);

  const close = (): void => {
    setOpen(false);
  };

  return (
    <>
      <Button
        onPress={() => {
          setOpen(true);
        }}
      >
        {m.licenses()}
      </Button>
      <Dialog isOpen={isOpen} onClose={close} title={m.licensesTitle()}>
        <div ref={content} tabIndex={-1} className="flex flex-col gap-4 outline-none">
          {/* Read again at each opening, and shown only in the opening that read it. */}
          {isOpen ? <Licenses /> : null}
          <div>
            <Button variant="primary" onPress={close}>
              {m.close()}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/**
 * The part of Settings about the app (architecture §5, §13): what it does, that the user's data
 * stays on the device, or that the app keeps none, that it is free software under AGPL-3.0, with
 * its source code, the licenses of the software it includes, and how to report a security problem.
 *
 * The links to the repository open a new tab: an app installed on an iPhone has no back button to
 * return from them.
 */
export function AboutSection({ name, description, keepsData = true }: AboutSectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col items-start gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {m.about(name)}
      </h2>
      <p>{description}</p>
      <p>{keepsData ? m.privacy() : m.privacyWithoutData()}</p>
      <p>{m.freeSoftware()}</p>
      <ul className="flex flex-col gap-2">
        {[
          { href: SOURCE_URL, text: m.sourceCode() },
          { href: SECURITY_URL, text: m.reportProblem() },
        ].map(({ href, text }) => (
          <li key={href}>
            <Link href={href} target="_blank" rel="noreferrer">
              {text}
            </Link>
          </li>
        ))}
      </ul>
      <LicensesButton />
    </section>
  );
}
