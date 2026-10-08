import type { CatalogApp } from "@shkriuss/shell/vite";
import { m } from "./messages.ts";

/**
 * Where an app is, at the hub's own host: the same build links to `<id>.shkriuss.dev` on
 * staging and to `<id>.shkriuss.app` in production (docs/specs/hub.md §2).
 */
function appUrl(id: string): string {
  return `https://${id}.${location.host}/`;
}

/** An app in the catalog: its icon, name and description, its privacy label, and its link. */
export function AppCard({ app }: { readonly app: CatalogApp }) {
  return (
    <li className="flex gap-4 rounded-lg border border-line p-4">
      <img src={app.icon} alt="" width={48} height={48} className="size-12 shrink-0" />
      <div className="flex min-w-0 flex-col gap-2">
        <h3 className="text-lg font-semibold wrap-anywhere">
          <a href={appUrl(app.id)}>{app.name}</a>
        </h3>
        <p>{app.description}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="font-medium">{m.dataCollected()}</dt>
          <dd>{m.noData()}</dd>
          <dt className="font-medium">{m.leavesDevice()}</dt>
          <dd>{app.keepsData ? m.onlyBackups() : m.nothing()}</dd>
          <dt className="font-medium">{m.permissions()}</dt>
          <dd>{m.features(app.allowedFeatures)}</dd>
        </dl>
      </div>
    </li>
  );
}
