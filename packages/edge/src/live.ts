import { readFile } from "node:fs/promises";
import path from "node:path";
import { MANIFEST_FILE, parseManifest, replacedAssets } from "./manifest.ts";

export type Fetch = (url: string) => Promise<Response>;

export interface LiveCheck {
  /** False when the origin serves no manifest yet, as before the first deployment. */
  readonly compared: boolean;
  /** Files in `/assets/` whose content would change under the same name. */
  readonly replaced: readonly string[];
}

/** True for the error `fetch` gives when the host has no DNS record. */
function isUnknownHost(error: unknown): boolean {
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  return cause instanceof Error && "code" in cause && cause.code === "ENOTFOUND";
}

/**
 * Compares a build with what `origin` serves now, using the published manifests. Before the
 * first deployment there is nothing to compare: the host has no DNS record yet, or it serves
 * no manifest, so the single-page fallback answers with HTML. Any other failure is an error.
 */
export async function checkAgainstLive(
  directory: string,
  origin: string,
  fetchUrl: Fetch = fetch,
): Promise<LiveCheck> {
  const next = parseManifest(await readFile(path.join(directory, MANIFEST_FILE), "utf8"));
  let response: Response;
  try {
    response = await fetchUrl(new URL(`/${MANIFEST_FILE}`, origin).href);
  } catch (error) {
    if (isUnknownHost(error)) {
      return { compared: false, replaced: [] };
    }
    throw error;
  }
  const type = response.headers.get("content-type") ?? "";
  if (response.status !== 200 || !type.startsWith("text/plain")) {
    return { compared: false, replaced: [] };
  }
  const live = parseManifest(await response.text());
  return { compared: true, replaced: replacedAssets(live, next) };
}
