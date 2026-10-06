import { Button, Dialog, Link } from "@shkriuss/ui";
import { useEffect, useId, useRef, useState } from "react";
import { LICENSES_PATH, SECURITY_URL, SOURCE_URL } from "./links.ts";
import { m } from "./messages.ts";

export interface AboutSectionProps {
  /** The app's name. */
  readonly name: string;
  /** What the app does, in a sentence. */
  readonly description: string;
}

/** What the licenses dialog shows: the text, or that it is on its way or could not be read. */
type Licenses =
  { readonly state: "loading" | "failed" } | { readonly state: "ready"; readonly text: string };

/**
 * The licenses of the software of others that the app includes, in a dialog, from the build's
 * `/licenses.txt`, which the service worker keeps offline. A tab of its own would not do: browsers
 * show a text file with styles that the Content-Security-Policy refuses.
 */
function LicensesButton() {
  const [isOpen, setOpen] = useState(false);
  const [licenses, setLicenses] = useState<Licenses>({ state: "loading" });
  // Counts the openings, so that a slow read shows only in the dialog that asked for it.
  const reads = useRef(0);
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The dialog opens at the top of the text, which arrow keys then scroll, rather than at its
    // button below the text, where the browser would put the focus.
    if (isOpen) {
      content.current?.focus();
    }
  }, [isOpen]);

  async function show(): Promise<void> {
    reads.current += 1;
    const read = reads.current;
    setOpen(true);
    setLicenses({ state: "loading" });
    let next: Licenses;
    try {
      const response = await fetch(LICENSES_PATH);
      if (!response.ok) {
        throw new Error(`The licenses answered with status ${response.status}.`);
      }
      next = { state: "ready", text: await response.text() };
    } catch {
      next = { state: "failed" };
    }
    if (read === reads.current) {
      setLicenses(next);
    }
  }

  const close = (): void => {
    reads.current += 1;
    setOpen(false);
  };

  let body;
  if (licenses.state === "ready") {
    body = (
      <pre className="rounded-lg bg-surface p-3 font-mono text-xs break-words whitespace-pre-wrap">
        {licenses.text}
      </pre>
    );
  } else {
    body = <p>{licenses.state === "loading" ? m.licensesLoading() : m.licensesFailed()}</p>;
  }

  return (
    <>
      <Button
        onPress={() => {
          void show();
        }}
      >
        {m.licenses()}
      </Button>
      <Dialog isOpen={isOpen} onClose={close} title={m.licensesTitle()}>
        <div ref={content} tabIndex={-1} className="flex flex-col gap-4 outline-none">
          {body}
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
 * stays on the device, that it is free software under AGPL-3.0, with its source code, the licenses
 * of the software it includes, and how to report a security problem.
 *
 * The links to the repository open a new tab: an app installed on an iPhone has no back button to
 * return from them.
 */
export function AboutSection({ name, description }: AboutSectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col items-start gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {m.about(name)}
      </h2>
      <p>{description}</p>
      <p>{m.privacy()}</p>
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
