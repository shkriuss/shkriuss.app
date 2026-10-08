# checks

The repository checks that linters and type checkers cannot do. `pnpm check` runs them from the repository's root, as `pnpm verify` and CI do. They read only the repository's files, those that git tracks and new ones that it does not ignore, so they work offline and see a change before it is committed.

```sh
pnpm check                  # every check
pnpm check doc-links html   # only the checks named
```

Each check prints ✓ and what it holds, or ✗ and every problem with its file. The command fails if any check found one.

| Check          | What it holds                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `dependencies` | Every `package.json` is private and AGPL-3.0-only, and takes its versions from the catalog                                                  |
| `html`         | HTML files have no inline scripts, styles, event handlers or `javascript:` URLs, and load nothing from other origins                        |
| `licenses`     | Every runtime dependency has a license that `license-policy.json` allows                                                                    |
| `markdown`     | Markdown files follow the rules of `.markdownlint.json`                                                                                     |
| `wrangler`     | Every app deploys static assets only, each environment on its own domain, never on `workers.dev`                                            |
| `structure`    | Every app, and each template, keeps the files of its template, an id equal to its folder, the platform's build and a test server of its own |
| `imports`      | Relative imports stay in their package, and nothing imports an app                                                                          |
| `doc-links`    | Relative links and `#anchors` in Markdown files lead somewhere                                                                              |

## Freshness

What Dependabot does not update, a weekly job of CI checks instead (`.github/workflows/freshness.yml`), with `node tooling/checks/src/freshness-cli.ts`. It asks the npm registry and the release schedule of Node.js, so `pnpm check`, which works offline, leaves it out. It fails when a newer pnpm of the major version that `packageManager` pins has been out for pnpm's release age, or when the Node.js of `.node-version` reaches its end of life within six months.

## The license policy

`license-policy.json` lists the licenses allowed for runtime dependencies, which ship to users inside the apps. Development dependencies are not distributed, and are not checked. An exception is keyed by `name@version`, so that every new version is reviewed again. A license that the policy does not list needs the maintainer's review first (`CLAUDE.md`, security rule 7).

## Adding a check

A check is a function in `src/` that returns the problems it finds, with unit tests, and an entry in `CHECKS` of `src/cli.ts`, with a description that says what it holds.
