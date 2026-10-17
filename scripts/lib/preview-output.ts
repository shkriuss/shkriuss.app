/** Helpers for turning `wrangler preview --json` output into a PR comment. */

export interface PreviewResult {
  slug: string;
  url: string | undefined;
}

/** Finds the preview URL in `wrangler preview --json` output (ignores any log lines). */
export function previewUrlFromJson(stdout: string): string | undefined {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1)) as {
      preview?: { urls?: unknown };
      deployment?: { urls?: unknown };
    };
    const urls = [parsed.preview?.urls, parsed.deployment?.urls]
      .flatMap((list) => (Array.isArray(list) ? list : []))
      .filter((url): url is string => typeof url === 'string' && url.startsWith('https://'));
    return urls[0];
  } catch {
    return undefined;
  }
}

/** The Markdown comment posted on the pull request. */
export function previewComment(results: readonly PreviewResult[], sha?: string): string {
  const rows = results.map(
    ({ slug, url }) => `| ${slug} | ${url ? url : '❌ failed (see the workflow log)'} |`,
  );
  return [
    '### Preview links',
    '',
    '| Site | Preview |',
    '| --- | --- |',
    ...rows,
    '',
    `Built from ${sha ? `commit ${sha.slice(0, 7)}` : 'the latest commit'}. These links update on every push and are deleted when this pull request is closed. They are public but hidden from search engines.`,
  ].join('\n');
}
