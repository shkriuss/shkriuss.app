# checks

The repository checks that linters and type checkers cannot do. `pnpm check` runs them from the repository's root, as `pnpm verify` and CI do. They read only the repository's files, those that git tracks and new ones that it does not ignore, so they work offline and see a change before it is committed.

```sh
pnpm check                  # every check
pnpm check doc-links html   # only the checks named
```

Each check prints ✓ and what it holds, or ✗ and every problem with its file. The command fails if any check found one.

| Check          | What it holds                                                                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dependencies` | Every `package.json` is private and AGPL-3.0-only, and takes its versions from the catalog                                                                                                                                                                                   |
| `html`         | HTML files have no inline scripts, styles, event handlers or `javascript:` URLs, and load nothing from other origins                                                                                                                                                         |
| `licenses`     | Every runtime dependency has a license that `license-policy.json` allows                                                                                                                                                                                                     |
| `markdown`     | Markdown files follow the rules of `.markdownlint.json`                                                                                                                                                                                                                      |
| `wrangler`     | Every app deploys static assets only, each environment on its own domain, never on `workers.dev`                                                                                                                                                                             |
| `structure`    | Every app, and each template, keeps the files of its template, an id equal to its folder, the platform's build and scripts, a `released:` line that is the value the hub reads, and a test server of its own; every folder in `apps/` is an app, and git has no build output |
| `imports`      | Relative imports stay in their package, and nothing imports an app                                                                                                                                                                                                           |
| `doc-links`    | Relative links and `#anchors` in Markdown files lead somewhere                                                                                                                                                                                                               |
| `code`         | TypeScript sources set no inline styles, and use no HTML sink, worker start or UI text spelling that lint cannot see                                                                                                                                                         |
| `workspace`    | `pnpm-workspace.yaml` keeps the supply-chain settings of ADR 0007, with plain versions, no patches and no install scripts; no `.npmrc` or pnpmfile exists                                                                                                                    |

## The code check

Oxlint refuses the HTML sinks written as a member access, `eval` and its relatives, the `style` prop, `Math.random`, text in JSX and strings in the attributes that people read or hear. `pnpm check code` refuses the spellings lint cannot see, in every `.ts` and `.tsx` file except unit tests (`*.test.ts`), end-to-end suites (`e2e/` folders) and its own source, with comments blanked first:

- `element.style.x = …`, `element.style = …`, `style.setProperty(…)` and `setAttribute("style", …)`;
- `DOMParser`;
- `new Worker(`, `new SharedWorker(` and `serviceWorker.register(` outside `packages/edge/browser/` ([ADR 0011](../../docs/decisions/0011-worker-trusted-types-policy.md));
- `Function.prototype.constructor` and `window.open(`;
- `document.title = "…"`;
- `innerHTML`, `outerHTML` or `insertAdjacentHTML` inside a call of `Object.assign` or `Reflect.set`;
- in `.tsx`, a string or template literal at the start of an attribute's `{…}` expression, for the attributes that `react/jsx-no-literals` restricts in `.oxlintrc.json`: `alt`, `aria-label`, `description`, `errorMessage`, `label`, `placeholder`, `title` and the other `aria-*` ones that are read aloud.

Two rules of `CLAUDE.md` are reviewed, not checked: never logging passphrases, and the `/*! … */` notice on material of others.

## The workspace check

`pnpm-workspace.yaml` is read line by line, as its top-level keys and the entries indented under them, so the check needs no YAML parser; a flow mapping (`key: { … }`) is refused. The check requires the settings of [ADR 0007](../../docs/decisions/0007-security-baseline.md): `minimumReleaseAge` of at least 4320 (three days), `trustPolicy: no-downgrade`, `blockExoticSubdeps: true`, `strictDepBuilds: true` and `engineStrict: true`. It refuses a `catalog`, `catalogs` or `overrides` entry that is not an exact version, a `^` or `~` range or a `catalog:` reference, so no git or tarball URL, `file:`, `link:`, `workspace:`, `npm:` alias or tag; the keys `patchedDependencies`, `pnpmfile`, `onlyBuiltDependencies` and `dangerouslyAllowAllBuilds`; and any `allowBuilds` entry other than `false`, unless `ALLOWED_BUILDS` in `src/workspace.ts` lists the package after an ADR. A `.npmrc`, `.pnpmfile.cjs`, `.pnpmfile.mjs` or `.pnpmfile.js` anywhere in the repository is refused too.

## Freshness

What Dependabot does not update, a weekly job of CI checks instead (`.github/workflows/freshness.yml`), with `node tooling/checks/src/freshness-cli.ts`. It asks the npm registry and the release schedule of Node.js, so `pnpm check`, which works offline, leaves it out. It fails when a newer pnpm of the major version that `packageManager` pins has been out for pnpm's release age, or when the Node.js of `.node-version` reaches its end of life within six months.

## The license policy

`license-policy.json` lists the licenses allowed for runtime dependencies, which ship to users inside the apps. Development dependencies are not distributed, and are not checked. An exception is keyed by `name@version`, so that every new version is reviewed again. A license that the policy does not list needs the maintainer's review first (`CLAUDE.md`, security rule 7).

## Adding a check

A check is a function in `src/` that returns the problems it finds, with unit tests, and an entry in `CHECKS` of `src/cli.ts`, with a description that says what it holds.
