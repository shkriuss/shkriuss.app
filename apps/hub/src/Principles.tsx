import { m } from "./messages.ts";

export default function Principles() {
  return (
    <section aria-labelledby="principles" className="mt-8 text-ink-muted">
      <h2 id="principles" className="mb-2 text-xl font-semibold text-ink">
        {m.expect()}
      </h2>
      <ul className="list-disc space-y-1 ps-6">
        <li>{m.local()}</li>
        <li>{m.offline()}</li>
        <li>{m.backups()}</li>
      </ul>
      <p className="mt-4">
        {m.source()} <a href="https://github.com/shkriuss/shkriuss.app">{m.sourceLink()}</a>
      </p>
      <p className="mt-4">
        {m.licenses()} <a href="/licenses.txt">{m.licensesLink()}</a>
      </p>
    </section>
  );
}
