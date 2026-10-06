import { Screen, SOURCE_URL } from "@shkriuss/shell/site";
import { createRoute } from "@tanstack/react-router";
import { m } from "../messages.ts";
import { rootRoute } from "./root.tsx";

/** The privacy policy, in plain language, at `/privacy` (docs/specs/hub.md §3). */
export const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/privacy",
  component: Privacy,
});

const CLOUDFLARE_POLICY = "https://www.cloudflare.com/privacypolicy/";

/** The history of the policy: its text is in this file's messages. */
const HISTORY = `${SOURCE_URL}/commits/main/apps/hub/src/messages.ts`;

function Privacy() {
  return (
    <Screen title={m.privacy()}>
      <p className="text-ink-muted">{m.privacyChanged()}</p>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{m.yourData()}</h2>
        <p>{m.yourDataText()}</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{m.host()}</h2>
        <p>{m.hostText()}</p>
        <p>
          <a href={CLOUDFLARE_POLICY}>{m.hostPolicy()}</a>
        </p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{m.backups()}</h2>
        <p>{m.backupsText()}</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{m.changes()}</h2>
        <p>{m.changesText()}</p>
        <p>
          <a href={HISTORY}>{m.changesLink()}</a>
        </p>
      </section>
    </Screen>
  );
}
