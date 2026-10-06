// A chunk that the page loads only when asked, as apps load their screens.

/** The build's name, from vite.config.ts. */
declare const PWA_E2E_BUILD: string;

export const lazy = `lazy of ${PWA_E2E_BUILD}`;
