/**
 * What a site without data, as the hub, shares with the apps: the frame, its screens and links,
 * and the links to the source code and to report a problem. Apps take `@shkriuss/shell`, which
 * has these too.
 */
export { Frame, type FrameProps } from "./Frame.tsx";
export { LICENSES_PATH, REPORT_URL, SECURITY_URL, SOURCE_URL } from "./links.ts";
export { listedApps } from "./listed.ts";
export { Screen, type ScreenProps } from "./Screen.tsx";
export { ScreenLink } from "./ScreenLink.tsx";
