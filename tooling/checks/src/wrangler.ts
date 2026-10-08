import { appHost, PRODUCTION_DOMAIN, STAGING_DOMAIN } from "@shkriuss/edge";
import { isRecord, type Violation } from "./report.ts";

/**
 * The Cloudflare configuration of every app (ADR 0001, ADR 0006):
 *
 * - static assets only, with no Worker script;
 * - staging reachable only through its custom domain, which Cloudflare Access protects:
 *   `workers.dev` and preview URLs would bypass Access, so both are off everywhere (Wrangler
 *   keeps an existing setting when the key is missing, so the keys must be there);
 * - each environment on its own domain: `apps/hub` at the apex, any other app at its id;
 * - nothing else: only the keys below, at the root and in each environment. Another key could
 *   add a build command, a Worker script, other files or other routes, which `wrangler deploy`
 *   would run or upload with the deploy token, after CI recorded the hash of every file.
 */

const CONFIG = /^apps\/([^/]+)\/wrangler\.json$/;
const OTHER_FORMAT = /^apps\/[^/]+\/wrangler\.(?:jsonc|toml)$/;
const ENVIRONMENTS = { staging: STAGING_DOMAIN, production: PRODUCTION_DOMAIN } as const;

/** The keys of an app's configuration, at its root and in each of its environments. */
const ROOT_KEYS = new Set([
  "$schema",
  "name",
  "compatibility_date",
  "assets",
  "workers_dev",
  "preview_urls",
  "send_metrics",
  "env",
]);
const ENVIRONMENT_KEYS = new Set(["name", "routes", "workers_dev", "preview_urls"]);

const SCHEMA = "./node_modules/wrangler/config-schema.json";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isWranglerConfig(file: string): boolean {
  return CONFIG.test(file) || OTHER_FORMAT.test(file);
}

/** A violation for each key of `object` that `allowed` does not have. */
function expectOnly(
  violations: Violation[],
  file: string,
  object: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  where: string,
): void {
  for (const key of Object.keys(object)) {
    if (allowed.has(key)) {
      continue;
    }
    let message = `${where}${key} is not allowed: apps are static assets on their own domains only (ADR 0006).`;
    if (key === "main") {
      message = `Apps are static assets only; remove ${where}main (ADR 0006).`;
    } else if (where === "" && (key === "routes" || key === "route")) {
      message = "Routes belong in env.staging and env.production only.";
    }
    violations.push({ file, message });
  }
}

function expectValue(
  violations: Violation[],
  file: string,
  object: Record<string, unknown>,
  key: string,
  expected: unknown,
  where: string,
): void {
  const actual = object[key];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    violations.push({
      file,
      message: `${where}${key} must be ${JSON.stringify(expected)}, not ${JSON.stringify(actual) ?? "missing"}.`,
    });
  }
}

export function checkWranglerConfig(file: string, source: string): Violation[] {
  if (OTHER_FORMAT.test(file)) {
    return [{ file, message: "Use wrangler.json, which pnpm check can read." }];
  }
  const directory = CONFIG.exec(file)?.[1];
  if (directory === undefined) {
    return [];
  }
  let config: unknown;
  try {
    config = JSON.parse(source);
  } catch (error) {
    return [{ file, message: `Invalid JSON: ${String(error)}` }];
  }
  if (!isRecord(config)) {
    return [{ file, message: "wrangler.json must contain a JSON object." }];
  }

  const violations: Violation[] = [];
  const appId = directory === "hub" ? undefined : directory;
  expectOnly(violations, file, config, ROOT_KEYS, "");
  if ("$schema" in config) {
    expectValue(violations, file, config, "$schema", SCHEMA, "");
  }
  const date = config["compatibility_date"];
  if (typeof date !== "string" || !DATE.test(date)) {
    violations.push({ file, message: "compatibility_date must be a date, as 2026-10-01." });
  }
  expectValue(violations, file, config, "name", `shkriuss-${directory}`, "");
  expectValue(
    violations,
    file,
    config,
    "assets",
    { directory: "./dist", not_found_handling: "single-page-application" },
    "",
  );
  for (const key of ["workers_dev", "preview_urls", "send_metrics"]) {
    expectValue(violations, file, config, key, false, "");
  }

  const environments = config["env"];
  if (!isRecord(environments)) {
    violations.push({ file, message: "env must define staging and production." });
    return violations;
  }
  const names = Object.keys(environments).toSorted();
  if (JSON.stringify(names) !== JSON.stringify(["production", "staging"])) {
    violations.push({
      file,
      message: `env must define exactly production and staging, not ${names.join(", ")}.`,
    });
  }
  for (const [name, domain] of Object.entries(ENVIRONMENTS)) {
    const environment = environments[name];
    if (!isRecord(environment)) {
      continue;
    }
    const where = `env.${name}.`;
    expectOnly(violations, file, environment, ENVIRONMENT_KEYS, where);
    expectValue(violations, file, environment, "name", `shkriuss-${directory}-${name}`, where);
    expectValue(
      violations,
      file,
      environment,
      "routes",
      [{ pattern: appHost(domain, appId), custom_domain: true }],
      where,
    );
    expectValue(violations, file, environment, "workers_dev", false, where);
    expectValue(violations, file, environment, "preview_urls", false, where);
  }
  return violations;
}

/** Every app needs a wrangler.json; the deployment reads nothing else. */
export function missingWranglerConfigs(files: readonly string[]): Violation[] {
  const apps = files.flatMap((file) => /^apps\/([^/]+)\/package\.json$/.exec(file)?.[1] ?? []);
  return apps
    .filter((app) => !files.includes(`apps/${app}/wrangler.json`))
    .map((app) => ({ file: `apps/${app}`, message: "Every app needs a wrangler.json." }));
}
