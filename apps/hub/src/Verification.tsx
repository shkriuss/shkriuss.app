import { m } from "./messages.ts";

/** How anyone can check what a site serves: its published hashes and build provenance. */
export default function Verification() {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold">{m.check()}</h2>
      <p>{m.checkText()}</p>
      {/* It wraps, rather than scroll sideways where keyboards cannot reach it. */}
      <pre className="rounded-lg border border-line bg-surface p-3 text-sm break-words whitespace-pre-wrap">
        <code>{m.checkCommand()}</code>
      </pre>
    </section>
  );
}
