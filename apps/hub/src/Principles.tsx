import { m } from "./messages.ts";

export default function Principles() {
  return (
    <section aria-labelledby="principles">
      <h2 id="principles">{m.expect()}</h2>
      <ul>
        <li>{m.local()}</li>
        <li>{m.offline()}</li>
        <li>{m.backups()}</li>
      </ul>
      <p>
        {m.source()} <a href="https://github.com/shkriuss/shkriuss.app">{m.sourceLink()}</a>
      </p>
      <p>
        {m.licenses()} <a href="/licenses.txt">{m.licensesLink()}</a>
      </p>
    </section>
  );
}
