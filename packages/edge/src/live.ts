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

/** The origin must serve its manifest itself, so a redirect counts as an answer. */
const fetchWithoutRedirects: Fetch = (url) => fetch(url, { redirect: "manual" });

/**
 * Compares a build with what `origin` serves now, using the published manifests.
 *
 * Before the first deployment there is nothing to compare: the host has no DNS record yet,
 * or it serves no manifest, so it answers 404 or the single-page fallback answers with HTML.
 * Any other answer is an error, such as an error status, a redirect or a challenge page, and
 * so is any other network failure: a check that skipped itself whenever the origin misbehaved
 * would protect nothing.
 */
export async function checkAgainstLive(
  directory: string,
  origin: string,
  fetchUrl: Fetch = fetchWithoutRedirects,
): Promise<LiveCheck> {
  const next = parseManifest(await readFile(path.join(directory, MANIFEST_FILE), "utf8"));
  const url = new URL(`/${MANIFEST_FILE}`, origin).href;
  let response: Response;
  try {
    response = await fetchUrl(url);
  } catch (error) {
    if (isUnknownHost(error)) {
      return { compared: false, replaced: [] };
    }
    throw error;
  }
  const type = response.headers.get("content-type") ?? "";
  if (response.status !== 200 || !type.startsWith("text/plain")) {
    await response.body?.cancel();
    if (response.status === 404 || (response.status === 200 && type.startsWith("text/html"))) {
      return { compared: false, replaced: [] };
    }
    throw new Error(
      `${url} answered with status ${response.status} and content type "${type}", not a manifest.`,
    );
  }
  const live = parseManifest(await response.text());
  return { compared: true, replaced: replacedAssets(live, next) };
}
