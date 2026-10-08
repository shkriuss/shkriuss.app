# create-app

Creates an app from the [app template](../app-template/README.md), or from the [app template without data](../app-template-no-data/README.md), in `apps/<id>` ([architecture §6](../../docs/architecture.md#6-anatomy-of-an-app)). Apps are created only this way (`CLAUDE.md`, structure rule 1).

```sh
pnpm create-app notes --name "Notes" --description "Notes that stay on this device."
pnpm install
pnpm --filter @shkriuss/notes dev
```

| Option          | What it is                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `<id>`          | The app's permanent id: its subdomain, as in `notes.shkriuss.app`. Lowercase letters, digits and inner hyphens |
| `--name`        | The app's name, as its frame, its page's title and installed apps show it                                      |
| `--description` | What the app does, in one sentence: in About, the manifest and the page's description                          |
| `--short-name`  | The name under its icon on a home screen, which shows at most 12 characters; needed if the name is longer      |
| `--accent`      | The color of its icons, as `#rrggbb`; the template's blue if left out                                          |
| `--no-data`     | The app keeps no data: it has no database and no backups, and starts from the app template without data        |

## What it does

1. **Checks the app:** the id must be a valid subdomain and not reserved ([ADR 0001](../../docs/decisions/0001-domains-and-environments.md)). It must be new: `apps/<id>` must not exist, and must never have existed in the repository's history, because an app's id is never used again (`CLAUDE.md`, product rule 3). A shallow clone lacks part of that history, so `create-app` asks for the rest first: `git fetch --unshallow`. The app's package name, `@shkriuss/<id>`, must not be a package of the workspace already, such as `@shkriuss/ui`. The names and the description must be one line each, and the short name at most 12 characters.
2. **Copies the template:** every file of `tooling/app-template`, or of `tooling/app-template-no-data` with `--no-data`, that git does not ignore, but what builds and tests leave there. It changes only what makes the app itself:
   - the package's name, `@shkriuss/<id>`;
   - the id and the accent color in `app.config.ts`;
   - the name, the short name and the description in `src/messages.ts`, written as strings, whatever they hold;
   - the test server's port: the first from 4200 up that no test server has, so that every app's tests can run at once.
3. **Writes the app's own** `README.md`, and its `wrangler.json`: the template's settings, with staging at `<id>.shkriuss.dev` and production at `<id>.shkriuss.app`, which `pnpm check` requires.
4. **Formats** every file with Prettier, as the repository does.

The app's end-to-end tests read its name and description from its messages, so they pass as they are. Then replace the example feature, `src/features/items`, or `src/features/words` in an app without data, with the app's own, and the glyph of its icons in `app.config.ts`.

**Deploying:** once the app is on `main`, CI deploys it as it deploys every app in `apps/`: to staging at `<id>.shkriuss.dev`, then, once the maintainer approves, to production at `<id>.shkriuss.app`. Its first deployment creates both domains; then check it as the [setup checklist](../../docs/setup-checklist.md#4-each-new-app) says.

## Tests

`src/create.test.ts` makes an app from the real template and checks it:

- **What changes:** every file of the template is there, and only the four files above differ.
- **The repository's checks accept it,** as `pnpm check` runs them: its structure, its test port and its Cloudflare configuration. So they do an app without data, which has no schema and no backups.
- **Names and descriptions** with quotes, backslashes and emoji read back as they were given.
- **Refusals:** ids that cannot be an app's, an id that an app has or had, that a package of the workspace has, or that a shallow clone cannot tell, names that are not one line, a long name without a short name, and accent colors that are not `#rrggbb`.
- **Turbo** runs them again when either template changes (`turbo.json`), rather than replay a cached result.
- **The template:** a change to it that `create-app` does not know fails, rather than making a broken app.
