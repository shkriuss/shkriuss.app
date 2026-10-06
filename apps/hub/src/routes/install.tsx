import { Screen } from "@shkriuss/shell/site";
import { createRoute } from "@tanstack/react-router";
import { m } from "../messages.ts";
import { rootRoute } from "./root.tsx";

/** How to install an app on each kind of device, at `/install` (docs/specs/hub.md §1). */
export const installRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/install",
  component: Install,
});

function Install() {
  return (
    <Screen title={m.installTitle()}>
      <p>{m.installIntro()}</p>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{m.iphone()}</h2>
        <ol className="list-decimal ps-6">
          <li>{m.iphoneOpen()}</li>
          <li>{m.iphoneShare()}</li>
          <li>{m.iphoneAdd()}</li>
        </ol>
        <p>{m.iphoneData()}</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{m.android()}</h2>
        <ol className="list-decimal ps-6">
          <li>{m.androidOpen()}</li>
          <li>{m.androidInstall()}</li>
        </ol>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">{m.computer()}</h2>
        <ul className="list-disc ps-6">
          <li>{m.computerChrome()}</li>
          <li>{m.computerSafari()}</li>
          <li>{m.computerOther()}</li>
        </ul>
      </section>
    </Screen>
  );
}
