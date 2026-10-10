import process from "node:process";
import { checkAgainstLive } from "./live.ts";

/**
 * Deployment checks, run in CI before `wrangler deploy`:
 *
 *   node packages/edge/src/cli.ts check-live <build directory> <origin>
 *
 * Fails when the build would serve a file in /assets/ that the origin already serves under
 * the same name with different content (ADR 0010), and when the origin does not serve its
 * manifest, unless its host has no DNS record yet.
 */
async function main(args: readonly string[]): Promise<number> {
  const [command, directory, origin] = args;
  if (command !== "check-live" || directory === undefined || origin === undefined) {
    process.stderr.write(
      "Usage: node packages/edge/src/cli.ts check-live <build directory> <origin>\n",
    );
    return 2;
  }
  const result = await checkAgainstLive(directory, origin);
  if (!result.compared) {
    process.stdout.write(`${origin} has no DNS record yet, so there is nothing to compare.\n`);
    return 0;
  }
  if (result.replaced.length === 0) {
    process.stdout.write(
      `✓ No file in /assets/ changes content under the same name on ${origin}.\n`,
    );
    return 0;
  }
  const lines = [
    `✗ These files would change content under the same name on ${origin}:`,
    ...result.replaced.map((file) => `  ${file}`),
    "Browsers keep them for a year, so returning visitors would get the old copy and fail its " +
      "integrity check. Find the build change that kept the names (ADR 0010) before deploying.",
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
  return 1;
}

process.exitCode = await main(process.argv.slice(2));
