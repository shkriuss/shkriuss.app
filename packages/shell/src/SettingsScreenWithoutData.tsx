import type { AppInstall } from "@shkriuss/pwa";
import { AboutSection } from "./AboutSection.tsx";
import { InstallSection } from "./InstallSection.tsx";
import { m } from "./messages.ts";
import { Screen } from "./Screen.tsx";

export interface SettingsScreenWithoutDataProps {
  /** The app's name and what it does, from its messages, for About. */
  readonly name: string;
  readonly description: string;
  /** How the app installs, from `appInstall()` of `@shkriuss/pwa`. */
  readonly install: AppInstall;
}

/**
 * The settings of an app without data (`keepsData: false` in its `app.config.ts`), at
 * `/settings`, where the frame links to: installing and About, alike in every app. It has
 * neither storage nor backups, and imports neither, so that the app's build has none of their
 * code.
 */
export function SettingsScreenWithoutData({
  name,
  description,
  install,
}: SettingsScreenWithoutDataProps) {
  return (
    <Screen title={m.settings()}>
      <div className="flex flex-col items-start gap-6">
        <InstallSection install={install} keepsData={false} />
        <AboutSection name={name} description={description} keepsData={false} />
      </div>
    </Screen>
  );
}
