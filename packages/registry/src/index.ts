/**
 * The app registry: the single list of every app on shkriuss.app.
 *
 * - The hub reads it to draw one card per app.
 * - Each app reads its own entry for its name, description, icon and colour.
 * - The privacy page reads it to show where each app keeps data.
 *
 * To add an app, use the generator (`pnpm new-app`), which edits apps.json for
 * you. See docs/adding-an-app.md.
 */
import data from '../apps.json' with { type: 'json' };

/** Background colours available for app icons (defined in @shkriuss/ui). */
export const ICON_COLORS = [
  'teal',
  'blue',
  'indigo',
  'violet',
  'pink',
  'red',
  'orange',
  'green',
  'slate',
] as const;
export type IconColor = (typeof ICON_COLORS)[number];

export const APP_STATUSES = ['live', 'beta', 'hidden'] as const;
/** live = listed; beta = listed with a "Beta" badge; hidden = deployed but not listed. */
export type AppStatus = (typeof APP_STATUSES)[number];

export const STORAGE_KINDS = ['none', 'device', 'server'] as const;
/** Where an app keeps user data. Shown on the privacy page. */
export type StorageKind = (typeof STORAGE_KINDS)[number];

export interface AppEntry {
  /** Lowercase id. Used for the subdomain, the folder in apps/ and the Worker name. */
  slug: string;
  name: string;
  /** One sentence, shown on the hub card. */
  description: string;
  /** Icon name from @shkriuss/ui. */
  icon: string;
  color: IconColor;
  status: AppStatus;
  storage: StorageKind;
  /** Plain-language list of what the app stores, for the privacy page. */
  dataStored: string[];
  /**
   * True if the app can send notifications while it's closed (optional, off
   * until turned on). Its Worker then runs @shkriuss/push (docs/adr/0009).
   */
  pushNotifications?: boolean;
  /**
   * True if the app can sync between devices through the optional shkriuss
   * account. Its Worker then runs @shkriuss/sync (docs/adr/0010).
   */
  sync?: boolean;
}

export interface HubEntry {
  name: string;
  domain: string;
  description: string;
  icon: string;
  color: IconColor;
}

export interface Registry {
  site: HubEntry;
  apps: AppEntry[];
}

/** Everything a site (the hub or an app) needs to know about itself. */
export interface SiteInfo {
  slug: string;
  kind: 'hub' | 'app';
  name: string;
  description: string;
  icon: string;
  color: IconColor;
  /** e.g. https://tally.shkriuss.app */
  origin: string;
  storage: StorageKind;
  dataStored: string[];
  pushNotifications: boolean;
  sync: boolean;
}

export const HUB_SLUG = 'hub';

/** Subdomains that must never be used for an app. */
export const RESERVED_SLUGS: readonly string[] = [
  HUB_SLUG,
  'www',
  'api',
  'app',
  'apps',
  'mail',
  'email',
  'admin',
  'auth',
  'login',
  'id',
  'static',
  'assets',
  'cdn',
  'dev',
  'staging',
  'preview',
  'status',
  'docs',
  'help',
  'support',
];

/** 2–30 characters: lowercase letters, digits and single hyphens; starts with a letter. */
export const SLUG_PATTERN = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){1,29}$/;

/** Returns a list of problems with a slug (empty when it is valid and unused). */
export function slugProblems(slug: string, existing: readonly string[] = []): string[] {
  const problems: string[] = [];
  if (!SLUG_PATTERN.test(slug)) {
    problems.push(
      `"${slug}" must be 2–30 characters of lowercase letters, digits and single hyphens, starting with a letter.`,
    );
  }
  if (RESERVED_SLUGS.includes(slug)) problems.push(`"${slug}" is reserved.`);
  if (existing.includes(slug)) problems.push(`"${slug}" is already used by another app.`);
  return problems;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

/** Checks registry data and returns it typed, or throws listing every problem found. */
export function validateRegistry(input: unknown): Registry {
  const problems: string[] = [];
  if (!isRecord(input)) throw new Error('Registry must be a JSON object.');

  const site = input['site'];
  if (!isRecord(site)) {
    problems.push('"site" must be an object.');
  } else {
    for (const key of ['name', 'domain', 'description', 'icon'] as const) {
      if (!isNonEmptyString(site[key])) problems.push(`site.${key} must be a non-empty string.`);
    }
    if (!oneOf(site['color'], ICON_COLORS)) {
      problems.push(`site.color must be one of: ${ICON_COLORS.join(', ')}.`);
    }
  }

  const apps = input['apps'];
  const seen: string[] = [];
  if (!Array.isArray(apps)) {
    problems.push('"apps" must be an array.');
  } else {
    apps.forEach((app: unknown, index) => {
      const where = `apps[${index}]`;
      if (!isRecord(app)) {
        problems.push(`${where} must be an object.`);
        return;
      }
      const slug = app['slug'];
      if (!isNonEmptyString(slug)) {
        problems.push(`${where}.slug must be a non-empty string.`);
      } else {
        problems.push(...slugProblems(slug, seen).map((p) => `${where}.slug: ${p}`));
        seen.push(slug);
      }
      for (const key of ['name', 'description', 'icon'] as const) {
        if (!isNonEmptyString(app[key]))
          problems.push(`${where}.${key} must be a non-empty string.`);
      }
      if (!oneOf(app['color'], ICON_COLORS)) {
        problems.push(`${where}.color must be one of: ${ICON_COLORS.join(', ')}.`);
      }
      if (!oneOf(app['status'], APP_STATUSES)) {
        problems.push(`${where}.status must be one of: ${APP_STATUSES.join(', ')}.`);
      }
      if (!oneOf(app['storage'], STORAGE_KINDS)) {
        problems.push(`${where}.storage must be one of: ${STORAGE_KINDS.join(', ')}.`);
      }
      const dataStored = app['dataStored'];
      if (!Array.isArray(dataStored) || !dataStored.every(isNonEmptyString)) {
        problems.push(`${where}.dataStored must be a list of strings (it can be empty).`);
      } else if (app['storage'] !== 'none' && dataStored.length === 0) {
        problems.push(`${where}.dataStored must say what is stored when storage is not "none".`);
      }
      for (const flag of ['pushNotifications', 'sync'] as const) {
        if (app[flag] !== undefined && typeof app[flag] !== 'boolean') {
          problems.push(`${where}.${flag} must be true or false.`);
        }
      }
    });
  }

  if (problems.length > 0) {
    throw new Error(`apps.json has problems:\n- ${problems.join('\n- ')}`);
  }
  return input as unknown as Registry;
}

export const registry: Registry = validateRegistry(data);
export const hub: HubEntry = registry.site;
export const apps: readonly AppEntry[] = registry.apps;

/** Apps shown on the hub (everything except "hidden"). */
export const listedApps: readonly AppEntry[] = apps.filter((app) => app.status !== 'hidden');

export const hubOrigin = `https://${hub.domain}`;

export function appOrigin(slug: string): string {
  return `https://${slug}.${hub.domain}`;
}

export function getApp(slug: string): AppEntry {
  const app = apps.find((entry) => entry.slug === slug);
  if (!app) {
    throw new Error(
      `No app with slug "${slug}" in packages/registry/apps.json. Known apps: ${
        apps.map((entry) => entry.slug).join(', ') || '(none)'
      }.`,
    );
  }
  return app;
}

/** Information about the hub (slug "hub") or any app. */
export function getSite(slug: string): SiteInfo {
  if (slug === HUB_SLUG) {
    return {
      slug: HUB_SLUG,
      kind: 'hub',
      name: hub.name,
      description: hub.description,
      icon: hub.icon,
      color: hub.color,
      origin: hubOrigin,
      storage: 'device',
      dataStored: [
        'If you use a shkriuss account: its key, on this device only (never in backups)',
        'Your light or dark theme choice',
      ],
      pushNotifications: false,
      sync: false,
    };
  }
  const app = getApp(slug);
  return {
    slug: app.slug,
    kind: 'app',
    name: app.name,
    description: app.description,
    icon: app.icon,
    color: app.color,
    origin: appOrigin(app.slug),
    storage: app.storage,
    dataStored: app.dataStored,
    pushNotifications: app.pushNotifications === true,
    sync: app.sync === true,
  };
}
