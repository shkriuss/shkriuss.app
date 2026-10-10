import { useEffect, useState } from "react";
import { LICENSES_PATH } from "./links.ts";
import { m } from "./messages.ts";

/** What the licenses show: the text, or that it is on its way or could not be read. */
type Read =
  { readonly state: "loading" | "failed" } | { readonly state: "ready"; readonly text: string };

/**
 * The licenses of the software of others that the site includes, from the build's
 * `/licenses.txt`, as text that wraps: in an app's About dialog, and on the hub's page. A tab
 * of the file itself would not do: browsers show a text file with styles that the
 * Content-Security-Policy refuses, and its long lines run off a phone's screen.
 *
 * It reads the file each time it appears, and shows only what it read itself.
 */
export function Licenses() {
  const [read, setRead] = useState<Read>({ state: "loading" });

  useEffect(() => {
    let shown = true;
    async function load(): Promise<void> {
      let next: Read;
      try {
        const response = await fetch(LICENSES_PATH);
        if (!response.ok) {
          throw new Error(`The licenses answered with status ${response.status}.`);
        }
        next = { state: "ready", text: await response.text() };
      } catch {
        next = { state: "failed" };
      }
      if (shown) {
        setRead(next);
      }
    }
    void load();
    return () => {
      shown = false;
    };
  }, []);

  if (read.state === "ready") {
    return (
      <pre className="rounded-lg bg-surface p-3 font-mono text-xs break-words whitespace-pre-wrap">
        {read.text}
      </pre>
    );
  }
  return <p>{read.state === "loading" ? m.licensesLoading() : m.licensesFailed()}</p>;
}
