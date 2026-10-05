/**
 * Domains and app hosts (ADR 0001). The hub is served at the apex of each domain, and every
 * app on a permanent subdomain named after its id. Runs in the browser too, as
 * `@shkriuss/edge/domains`.
 */
export const PRODUCTION_DOMAIN = "shkriuss.app";
export const STAGING_DOMAIN = "shkriuss.dev";

/** Names that can never be app ids (ADR 0001). */
export const RESERVED_IDS = [
  "www",
  "account",
  "api",
  "auth",
  "id",
  "admin",
  "status",
  "mail",
  "static",
] as const;

/** A lowercase DNS label: letters, digits and inner hyphens. */
const APP_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Whether `id` can be an app id, and so a subdomain. */
export function isAppId(id: string): boolean {
  return APP_ID.test(id) && !(RESERVED_IDS as readonly string[]).includes(id);
}

/** Throws unless `id` can be an app id, and so a subdomain. */
export function assertAppId(id: string): void {
  if (!APP_ID.test(id)) {
    throw new Error(
      `"${id}" is not a valid app id: use lowercase letters, digits and inner hyphens.`,
    );
  }
  if ((RESERVED_IDS as readonly string[]).includes(id)) {
    throw new Error(`"${id}" is reserved and can never be an app id.`);
  }
}

/** The host an app is served from: the apex for the hub (no id), otherwise `<id>.<domain>`. */
export function appHost(domain: string, appId?: string): string {
  if (appId === undefined) {
    return domain;
  }
  assertAppId(appId);
  return `${appId}.${domain}`;
}
