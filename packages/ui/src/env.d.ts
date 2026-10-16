/// <reference types="astro/client" />

/**
 * Details of the site being built (the hub or one app). This virtual module is
 * provided at build time by @shkriuss/astro-config from the registry entry.
 */
declare module 'virtual:shkriuss/site' {
  import type { SiteInfo } from '@shkriuss/registry';

  export const site: SiteInfo;
  /** e.g. https://shkriuss.app */
  export const hubOrigin: string;
}
