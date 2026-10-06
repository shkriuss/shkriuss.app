import type { Schemas } from "@shkriuss/data";
import type { AppInstall, AppStorage } from "@shkriuss/pwa";
import type { ReactNode } from "react";
import { AboutSection } from "./AboutSection.tsx";
import { BackupSection, type BackupSectionProps } from "./BackupSection.tsx";
import { InstallSection } from "./InstallSection.tsx";
import { m } from "./messages.ts";
import { Screen } from "./Screen.tsx";
import { StorageSection } from "./StorageSection.tsx";

export interface SettingsScreenProps {
  /** The app's id, which names its backups. */
  readonly app: string;
  /** The app's name and what it does, from its messages, for About. */
  readonly name: string;
  readonly description: string;
  /** The app's database, which backups save and restore. */
  readonly db: BackupSectionProps["db"];
  /** Every version of the app's schema, to read backups of older versions. */
  readonly schemas: Schemas;
  /** How the app installs, from `appInstall()` of `@shkriuss/pwa`. */
  readonly install: AppInstall;
  /** The app's storage, from `appStorage()` of `@shkriuss/pwa`. */
  readonly storage: AppStorage;
  /** The app's own settings, if it has any, before those that every app has. */
  readonly children?: ReactNode;
}

/**
 * The settings of an app, at `/settings`, where the frame links to: the app's own, then those
 * that every app has, alike in every app: installing, storage, backups, and About.
 */
export function SettingsScreen({
  app,
  name,
  description,
  db,
  schemas,
  install,
  storage,
  children,
}: SettingsScreenProps) {
  return (
    <Screen title={m.settings()}>
      <div className="flex flex-col items-start gap-6">
        {children}
        <InstallSection install={install} />
        <StorageSection storage={storage} />
        <BackupSection app={app} db={db} schemas={schemas} />
        <AboutSection name={name} description={description} />
      </div>
    </Screen>
  );
}
