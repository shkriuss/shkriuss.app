# Hub site

The project's website. It shows the apps, how to install them with
Obtainium, how to check them with AppVerifier against the signing
fingerprint, and a link to the source. Set up in Phase 0, step 7.

- The workflow is [`site.yml`](../../.github/workflows/site.yml).
- The generator is [`tools/site/build.py`](../../tools/site/build.py).
  Why a script: [ADR 0022](../adr/0022-hub-site-generator.md).
- It is served by the Cloudflare Worker `shkriuss-hub`, which has static
  files only and no Worker script. Why, and how the deploy is protected:
  [ADR 0023](../adr/0023-hub-site-hosting-and-deploy.md).
- The site has no JavaScript, no cookies, no analytics and no fonts from
  other sites. Light and dark follow the phone's setting, with the palette
  of [ADR 0017](../adr/0017-design-system-tokens.md).

## Pages

[`site/site.json`](../../site/site.json) lists the pages:

| Address | Made from |
|---|---|
| `/` | [`site/index.md`](../../site/index.md) |
| `/apps/` | [`docs/user/apps.md`](../user/apps.md) |
| `/install/` | [`docs/user/install.md`](../user/install.md) |
| `/verify/` | [`docs/user/verify.md`](../user/verify.md), plus the fingerprint and package names from [`fingerprints.md`](../security/fingerprints.md) |
| Any other address | [`site/404.md`](../../site/404.md) |

Every page has a link to the source code on GitHub. A link in a page to
another page of the site stays on the site. A link to any other file of
the repository goes to that file on GitHub.

## What the workflow does

| Job | When | What it does | Secrets |
|---|---|---|---|
| Build | Pull requests that change `docs/`, `site/`, `tools/site/` or the site's workflow files, and every push to `main` | Runs the generator's tests. Builds the site. Checks the built files. Adds the security headers. Records a SHA-256 for every file. Uploads the site as the artifact `site`. | None |
| Deploy tool | Pull requests only | Installs the pinned Wrangler and tries the deploy with the built site, without uploading. So a broken pin or Worker configuration fails the pull request, not `main`. | None |
| Deploy | Pushes to `main`, and runs started by hand on `main` | Stops if a newer commit is on `main`. Checks the files against Build's SHA-256 values. Installs the pinned Wrangler. Stops unless the Worker exists. Deploys a new version of it. Checks that the live site serves exactly the uploaded files, with every security header. | `CLOUDFLARE_API_TOKEN`, in one step |

Pull requests are never deployed. "Site / Build" is not a required check.
It runs only when a pull request changes the site.

### What Build checks

The checks do not trust the generator. They look at what it wrote:

1. Only plain files, with lower-case names ending in `.html`, `.css` or
   `.svg`. So no Cloudflare control file such as `_redirects`, and no
   script file, can reach Cloudflare.
2. No `<script>`, `<style>`, frame, form, plugin, `<base>` or meta
   refresh. No event handler such as `onclick`, no `style` or `src`
   attribute, no `javascript:` address.
3. Links go to `https://...`, to the site itself (`/...`) or to a heading
   (`#...`). The style sheet and the icon come from the site itself, and
   load nothing themselves.

## Security headers

`site.yml` writes them into the file `_headers`, which Cloudflare reads for
the Worker's static files. They are in the workflow, not in `site/`, so
only the owner can change them. After every deploy, the job Deploy asks the
live site for every file. It fails unless each answer has each header once,
with exactly the value below. For an address that does not exist, it only
warns.

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | `default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` | The browser runs no script at all, and loads only the site's own style sheet and icon. |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | Browsers use only HTTPS for two years. |
| `X-Content-Type-Options` | `nosniff` | Browsers do not guess file types. |
| `X-Frame-Options` | `DENY` | No other site can show the site in a frame. Older browsers. |
| `Referrer-Policy` | `no-referrer` | Other sites are not told which page a visitor came from. |
| `Permissions-Policy` | Every listed feature off: camera, microphone, location, sensors, payment, USB and more | The site never asks for them. |
| `Cross-Origin-Opener-Policy` | `same-origin` | Other sites' windows cannot reach the site's window. |
| `Cross-Origin-Resource-Policy` | `same-origin` | Other sites cannot embed the site's files. |
| `Cross-Origin-Embedder-Policy` | `require-corp` | The site loads nothing from other sites. |

There are no cookies to protect: the site sets none.

## Set up Cloudflare

Do this once, before the first deploy. Only you can, because Claude has no
Cloudflare access and cannot change repository settings. Do it before you
merge the pull request that adds the workflow: a run that names an
environment that does not exist creates it, with no protection.

| What | Kind | Where |
|---|---|---|
| The Worker `shkriuss-hub` | Made by you, by hand | Cloudflare dashboard |
| `CLOUDFLARE_API_TOKEN` | Secret | Environment secret of the `cloudflare` environment on GitHub |
| `CLOUDFLARE_ACCOUNT_ID` | Not secret | Environment variable of the `cloudflare` environment on GitHub |

Neither value goes into the repository or a Claude session. The account ID
appears in the public run logs. That is fine: it does nothing without a
token.

### 1. The Worker

The token may only edit this one Worker, and cannot create it. So you make
it first, empty.

1. Open `dash.cloudflare.com` in the browser and sign in.
2. Open **Workers & Pages** from the menu.
3. Tap **Create application**.
4. Tap **Start with Hello World!**, then **Get started**. Do not pick an
   option that connects a Git repository.
5. Name the Worker `shkriuss-hub`. Exactly this name: the workflow deploys
   only to it.
6. Tap **Deploy**.
7. If Cloudflare asks you to choose your `workers.dev` subdomain, choose
   one. It becomes part of the site's address,
   `https://shkriuss-hub.<your subdomain>.workers.dev`.

The Worker says "Hello World!" until the first deploy replaces it with the
site.

### 2. The account ID

1. In the Cloudflare dashboard, look at the address bar. It reads
   `dash.cloudflare.com/<account ID>/...`. The account ID is the 32
   characters, digits and letters `a` to `f`, after the first slash.
2. Copy it.

### 3. The token

It must be an account API token, not a user token. Wrangler keeps to one
Worker only with an account API token.

1. In the Cloudflare dashboard, open **Manage account**, then **Account API
   tokens**.
2. Tap **Create Token**. If Cloudflare offers templates, pick a custom
   token.
3. Name it `shkriuss.app site deploy`.
4. Add one permission: **Workers**, with the scope **Specified Workers**.
   Pick `shkriuss-hub`. Pick the role **Editor**.
5. Add no other permission. No zone permission: the token never touches
   your domain.
6. Leave **Client IP Address Filtering** empty. GitHub's runners have no
   fixed address.
7. You may set an end date. Then make a new token before it ends, and
   replace the secret.
8. Tap **Continue to summary**. Check that it shows only Editor on
   `shkriuss-hub`. Tap **Create Token**.
9. Copy the token. It starts with `cfat_`. Cloudflare shows it only once.
   Never paste it into a Claude session.

#### If your account does not offer Specified Workers

1. Make the same account API token, but with the scope **All Workers** and
   the role **Editor**. Editor still cannot create or delete a Worker, but
   it can change every Worker in your account, including the sync server
   later.
2. If your account does not offer **Account API tokens** at all, make a
   user token at `dash.cloudflare.com/profile/api-tokens` instead:
   **Create Token**, then **Custom token**, with one permission:
   **Account**, **Workers Scripts**, **Edit**. That is the older name for
   Editor on all Workers.
3. Tell Claude which one you made, so ADR 0023 records the wider token.
4. Replace it with a token for `shkriuss-hub` alone as soon as your account
   offers one.

### 4. The environment

1. Open `github.com/shkriuss/shkriuss.app/settings/environments` in the
   browser.
2. If `cloudflare` is listed, tap it. Otherwise tap **New environment**,
   type `cloudflare` and tap **Configure environment**.
3. Under **Deployment branches and tags**, pick **Selected branches and
   tags**. Tap **Add deployment branch or tag rule**, pick **Branch**, type
   `main` and tap **Add rule**.
4. Under **Environment secrets**, tap **Add environment secret**. Name:
   `CLOUDFLARE_API_TOKEN`. Value: the token. Tap **Add secret**.
5. Under **Environment variables**, tap **Add environment variable**.
   Name: `CLOUDFLARE_ACCOUNT_ID`. Value: the account ID. Tap **Add
   variable**.

The plan asks for an approval only for the `release` environment, so
`cloudflare` needs no required reviewer. Every merge then deploys by
itself. If you want to approve each deploy, tick **Required reviewers** and
add `shkriuss`.

### 5. The first deploy

1. Merge the pull request. Its push to `main` starts the workflow. Or, if
   it is merged already, open
   `github.com/shkriuss/shkriuss.app/actions/workflows/site.yml`, tap **Run
   workflow**, leave the branch at `main` and tap **Run workflow**.
2. Wait for **Deploy** to finish. Its summary names the address,
   `https://shkriuss-hub.<your subdomain>.workers.dev`, and the new
   version of the Worker.
3. Open the address. Check every page, in light and in dark mode.
4. Open `github.com/shkriuss/shkriuss.app/deployments`. The environment
   `cloudflare` links to the same address.

Write down anything that did not match these steps, so Claude can fix this
page.

### 6. Your domain

You attach `shkriuss.app` by hand. The workflow never changes routes or
domains, and the token cannot.

1. In **Workers & Pages**, tap `shkriuss-hub`.
2. Open **Settings**, then **Domains & Routes**. Tap **Add**, then
   **Custom Domain**.
3. Type `shkriuss.app` and tap **Add Custom Domain**.

The domain must be in the same Cloudflare account, and must not have a
CNAME record for that name. Cloudflare makes the DNS record and the
certificate. Every later deploy keeps the domain, and it serves the same
version as the `workers.dev` address.

Open: whether Deploy should also check the headers on `shkriuss.app`.
Today it checks the `workers.dev` address.

## When Deploy fails

Tap the failed step to see the message.

| Message | What to do |
|---|---|
| The cloudflare environment has no secret CLOUDFLARE_API_TOKEN. | Add it ([The environment](#4-the-environment), step 4). |
| The cloudflare environment needs the variable CLOUDFLARE_ACCOUNT_ID ... | Add it ([The environment](#4-the-environment), step 5). Check that it is exactly 32 characters. |
| The Worker shkriuss-hub does not exist. ... | Create it ([The Worker](#1-the-worker)). The name must be exactly `shkriuss-hub`. |
| The token cannot reach the Worker shkriuss-hub. ... | The Worker does not exist, or the token is wrong: expired, for another account, a user token, or without Editor on `shkriuss-hub`. Check the Worker, then make a new token ([The token](#3-the-token)) and replace the secret. |
| A Wrangler error that names the `workers.dev` subdomain | Choose your subdomain in **Workers & Pages**, then run the workflow again. |
| A Wrangler error with "Authentication error" or code 10000 | Wrangler needed a permission the token does not have. Ask Claude, with the message. Do not widen the token on a guess. |
| Wrangler did not report ... | Ask Claude, with the message. |
| ... answered HTTP ..., not 200 with the uploaded file. | The new version did not appear within two minutes. Run the workflow again. If it happens again, ask Claude. |
| ... does not send the header ... exactly as in _headers. | Cloudflare changed or added a header. The site is online, but not as strict as intended. Ask Claude, with the message. |
| The downloaded site is not the one the job Build made and checked. | Nothing was deployed. Run the workflow again. If it happens again, ask Claude. |
| A newer commit is on main. | Not an error. The newer commit's run deploys. |

To stop the site at once, open the Worker in the Cloudflare dashboard. In
**Deployments**, roll back to an older version. Or, under **Settings**,
**Domains & Routes**, turn off the `workers.dev` address and remove the
domain.

## Markdown the generator reads

The generator reads only the part of GitHub's Markdown that the docs use.
On anything else it stops, and names the file and the line. On a pull
request, the message also shows next to the line in **Files changed**.

It reads:

- `#` headings. Each gets the same anchor as on GitHub.
- Paragraphs.
- Bullet lists with `-`, numbered lists with `1.`, and lists inside list
  items. Lines of a list item line up with its text.
- Fenced code blocks, with ```` ``` ```` or `~~~`, and a language name or
  none.
- Tables, with `:` in the row of dashes for alignment, and `\|` for a
  pipe inside a cell.
- `` `code` ``, `**bold**`, `*italic*`, `_italic_` and backslash escapes.
- Links `[text](destination)`, `<https://...>` and bare `https://...`
  addresses.
- HTML comments, which are left out, and the line
  `<!-- site: fingerprints -->`.
- `---` as a dividing line.

It stops on, for example:

- raw HTML such as `<b>`, images, block quotes, HTML entities such as
  `&copy;`,
- tabs, indented code blocks, underlined headings, a backslash at the end
  of a line,
- `*` or `+` bullets, `1)` numbers, empty list items, and a list line that
  is not indented,
- link titles, `http://` links, `mailto:` links, and links to a file or
  heading that does not exist.

A page starts with one `#` heading, its title, and has no other `#`
heading.

## Add or change a page

1. Write or change the page in `docs/`, for a page that also belongs on
   GitHub, or in `site/`, for a page only the site needs.
2. To add a page, add it to `site/site.json`: its `path`, which ends in
   `/index.html`, its `source`, and `nav`, the label in the menu.
3. Link to other pages by their relative path, as everywhere in `docs/`.
4. Open a pull request. The job **Build** builds and checks the site.

A new app is added to `docs/user/apps.md`. When it is signed with the
suite key, the owner adds it to the table in `fingerprints.md`, and the
verify page shows it.

## Run it in the cloud environment

Claude runs these from the repository root before every push that changes
the site:

```bash
python3 -B -m unittest discover -s tools/site -t tools/site
```

```bash
python3 -B tools/site/build.py /tmp/site
```

The site cannot be looked at on a phone before it is merged. Claude can
take screenshots of the built pages in a session.

## Update Wrangler

The files in `.github/site-deploy/` are owner-only. Claude changes them
only when you ask for exactly that.

1. Pick a Wrangler release that is more than a month old, unless a fix is
   needed, as for 4.156.2 ([ADR 0023](../adr/0023-hub-site-hosting-and-deploy.md)).
   Read its release notes.
2. Change the version in `.github/site-deploy/package.json`.
3. In `.github/site-deploy/`, run
   `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`.
   It rewrites `package-lock.json`.
4. Check that `install.sh` installs it:
   `.github/site-deploy/install.sh /tmp/deploy`.
5. Open a pull request. The job **Deploy tool** installs it again on
   GitHub, and tries the deploy without uploading.

Open: whether prompt R5 in [PROMPTS.md](PROMPTS.md) should include this.

## How it was tested

Before the first merge, in the cloud environment:

1. 34 unit tests of the generator, on Python 3.11, 3.12 and 3.13.
2. Every Markdown file of the repository, 62 files, rendered by the
   generator and by pandoc 3.1.3 (GFM), gave the same structure and text,
   except the intended differences listed in ADR 0022. All 382 headings got
   the same anchors. Every link to a file or a heading in them exists.
3. Chromium showed every page with the real security headers, on a phone,
   at 320 px wide and on a tablet, in light and dark. No page scrolled
   sideways, the style sheet and the icon loaded, every menu link was at
   least 48 px high, and the lowest text contrast was 6.61:1 in light and
   7.68:1 in dark. The AppVerifier box copies as exactly two lines.
4. The shell steps of `site.yml`, taken from the file, passed 69 checks
   against stand-ins for GitHub, the Cloudflare API, Wrangler and
   `workers.dev`. Among them: 22 kinds of harmful file that Build must
   refuse; a Worker that does not exist, a token that cannot reach it, a
   missing secret or variable, where Wrangler never ran; Wrangler
   reporting another Worker, no new version or another address; an older
   commit; a changed artifact; and a live site that still serves the old
   version, sends a header twice or not at all, or turns away a default
   User-Agent. The token never appeared on a command line or in the log.
5. `install.sh` installed the pinned Wrangler from the lockfile. A changed
   checksum in the lockfile, and a too-old Node.js, both stopped it. The
   real Wrangler 4.156.2 tried the deploy of the built site with the real
   `wrangler.jsonc`, without uploading.
6. Claude read the requests that Wrangler 4.156.2 makes to deploy this
   configuration. All are about the Worker itself. None is about a zone,
   a domain or another Worker, as long as the Worker already has its
   `workers.dev` address, which a Worker made in the dashboard has.
7. `actionlint` with `shellcheck` found no problems.

Not tried, because Claude has no Cloudflare access: the real token and its
per-Worker scope, the real upload, how Cloudflare sends `_headers`, and the
labels in the Cloudflare dashboard. The first deploy tries the first three,
and the job Deploy checks them on every run.
