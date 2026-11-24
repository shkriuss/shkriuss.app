# Hub site

The project's website. It shows the apps, how to install them with
Obtainium, how to check them with AppVerifier against the signing
fingerprint, and a link to the source.

- The workflow is [`site.yml`](../../.github/workflows/site.yml).
- The generator is [`tools/site/build.py`](../../tools/site/build.py).
  Why a script: [ADR 0022](../adr/0022-hub-site-generator.md).
- It is served by the Cloudflare Worker `shkriuss-hub`, which has static
  files only and no Worker script. Why, and how the deploy is protected:
  [ADR 0023](../adr/0023-hub-site-hosting-and-deploy.md).
- It is live at <https://shkriuss.app>.
- The site has no JavaScript, no cookies, no analytics and no fonts from
  other sites. Light and dark follow the phone's setting, with the palette
  of [ADR 0017](../adr/0017-design-system-tokens.md).
- The pages follow the apps' rules for a phone: no page scrolls
  sideways on a phone 320 px wide, every menu link is at least 48 px
  high, and text contrast is at least 4.5:1 in light and dark.

## Pages

[`site/site.json`](../../site/site.json) lists the pages:

| Address | Made from |
|---|---|
| `/` | [`site/index.md`](../../site/index.md) |
| `/apps/` | [`docs/user/apps.md`](../user/apps.md) |
| `/install/` | [`docs/user/install.md`](../user/install.md) |
| `/verify/` | [`docs/user/verify.md`](../user/verify.md), plus the fingerprint and package names from [`fingerprints.md`](../security/fingerprints.md) |
| `/privacy/` | [`docs/user/privacy.md`](../user/privacy.md) |
| `/water/` | [`docs/user/water.md`](../user/water.md) |
| `/reminders/` | [`docs/user/reminders-app.md`](../user/reminders-app.md) |
| `/tasks/` | [`docs/user/tasks.md`](../user/tasks.md) |
| `/recovery-key/` | [`docs/user/recovery-key.md`](../user/recovery-key.md) |
| `/app-lock/` | [`docs/user/app-lock.md`](../user/app-lock.md) |
| `/backup/` | [`docs/user/backup.md`](../user/backup.md) |
| `/notifications/` | [`docs/user/reminders.md`](../user/reminders.md) |
| Any other address | [`site/404.md`](../../site/404.md) |

The menu shows Apps, Install, Verify, Privacy, Water, Reminders and
Tasks. The pages of the recovery key, the app lock, backups, and
reminders and notifications are not in the menu: the pages of Water,
Reminders and Tasks and the other guides link to them. On the verify
page, the box for AppVerifier copies as exactly two lines.

Every page has a link to the source code on GitHub. A link in a page to
another page of the site stays on the site. A link to any other file of
the repository goes to that file on GitHub.

## What the workflow does

| Job | When | What it does | Secrets |
|---|---|---|---|
| Build | Pull requests that change `docs/`, `site/`, `tools/site/` or the site's workflow files, and every push to `main` | Runs the generator's tests. Builds the site. Uploads what the generator wrote, hidden files included, as the artifact `site-unchecked`, kept for one day. | None |
| Check the site | After Build | Starts on a new runner and checks out nothing. Downloads `site-unchecked`. Tests its own checks first, then checks the built files. Adds the security headers. Records a SHA-256 for every file. Uploads the site as the artifact `site`. | None |
| Deploy tool | Pull requests only | Installs the pinned Wrangler and tries the deploy with the checked site, without uploading. So a broken pin or Worker configuration fails the pull request, not `main`. | None |
| Deploy | Pushes to `main`, and runs started by hand on `main` | Stops if a newer commit is on `main`. Checks the files against the SHA-256 values of Check the site. Installs the pinned Wrangler. Stops unless the Worker exists. Deploys a new version of it. Checks that the live site serves exactly the uploaded files, with every security header: on the `workers.dev` address, and on your own domain if `SITE_DOMAIN` is set. | `CLOUDFLARE_API_TOKEN`, in one step |

Pull requests are never deployed. "Site / Build" and "Site / Check the
site" are not required checks. They run only when a pull request changes
the site.

`CLOUDFLARE_API_TOKEN` never appears on a command line or in the log.

### What Check the site checks

The checks do not trust the generator. They look at what it wrote, on a
runner where it never ran:

- The generator runs in Build. Code that runs there can change what the
  later steps of that job do, for example by writing to `$GITHUB_ENV`.
  So Build checks nothing that Deploy relies on.
- Check the site checks out nothing. Nothing from the repository or from
  Build runs in it: the built site comes in as files to read, and the
  checks are written in `site.yml`.
- They read each file whole and parse it, with the standard library of
  the runner's Python, started with `-I` so that it ignores the
  environment and the files it reads.
- The check tests itself first ([The self-test](#the-self-test)).

What they check:

1. Only plain files, with lower-case names ending in `.html`, `.css` or
   `.svg`. So no Cloudflare control file such as `_redirects`, and no
   script file, can reach Cloudflare. A folder that cannot be listed
   fails, and so does a file that is not UTF-8.
2. No `<script>`, `<style>`, frame, form, plugin, `<base>` or meta
   refresh. No event handler such as `onclick`, no `style` or `src`
   attribute, no `javascript:` address.
3. Links go to `https://...`, to the site itself (`/...`) or to a heading
   (`#...`). Only `<a>` may link to another site. Any other `href`, such
   as on a `<link>` or on an SVG `<image>` in a page, loads what it names,
   so it must stay on the site. The style sheet and the icon come from
   the site itself, and load nothing themselves.
4. A page holds only the elements that the generator writes, and each
   element only the attributes that the generator gives it. For example,
   `class` is allowed on `<a>`, `<div>`, `<th>` and `<td>`, and nowhere
   else. Anything else fails, such as `<span>`, or the old attribute
   `background`, which loads an image. So a way to load something that no
   rule above names fails too. The list is in `site.yml`, next to the
   checks. When the generator starts to write a new element or attribute,
   the same pull request adds it to the list.

How they read the files:

1. The rules above run on the raw text of each file, read whole, not
   line by line. So a tag broken over two lines is still one tag.
2. Each page is parsed with Python's HTML parser. Every element and
   attribute is checked as the parser reads it: with any quotes or none,
   and with character references such as `&#x73;` decoded. An address is
   read as a browser reads it: tabs and line breaks dropped, spaces at
   either end dropped, and `\` read as `/`.
3. A page fails if it holds anything that a browser might read in
   another way than the parser: a comment, a CDATA section, a processing
   instruction, a declaration other than `<!doctype html>`, or a `<` that
   is not a tag. The generator writes none of them.
4. The icon is parsed as XML. It may have no DOCTYPE, so no entities, no
   processing instruction, such as `<?xml-stylesheet?>`, and no comment.
5. The style sheet is checked as written, and again with its CSS escapes
   decoded, so `u\72l(` counts as `url(`. As in CSS, CR LF, CR and a
   form feed are first read as one line break, so an escape followed by
   CR LF is decoded as a browser decodes it.

### The self-test

The check tests itself before it checks the built site. The checks and
the self-test are one script in `site.yml`, so the self-test runs the
same functions that then check the site, not a copy of them.

1. The step "Test the site checker" runs the checks on a small good
   site: two pages, a style sheet and an icon, written in the script. It
   must have no problem.
2. Then it runs them on samples. Each sample is that good site with one
   fault, so the fault is the only reason it can fail.
3. Each sample names every message its fault must cause. The self-test
   fails if a named message is missing, or if any other message appears.
   So a sample that is refused for another reason does not count.
4. Every rule has at least one sample: the file rules, each rule on the
   raw text, each rule on the parsed elements and attributes, the
   parser's own cases (a stray `<`, a comment, a declaration, a
   processing instruction, a CDATA section), the icon's XML rules, the
   CSS escapes and a file that is not UTF-8. Each tag and each attribute
   that the site does not allow has its own sample. Their names are
   written out in the self-test, not taken from the rules, so a shorter
   list in a rule fails it.
5. Where both the raw text and the parser catch a fault, another sample
   holds a fault that only the parser catches. Examples: a meta refresh
   behind a quoted `>`, an event handler after a `/`, a link without
   quotes, and a `javascript:` address written with `&#x73;` or a tab.
   An `href` in the icon is the one fault with no such sample: the raw
   text always shows the word.
6. Only when the self-test passes does the step "Check the built site"
   run.

To add a rule: add a sample for it, and one for each fault that only
the new rule catches.

## Security headers

`site.yml` writes them into the file `_headers`, which Cloudflare reads for
the Worker's static files. They are in the workflow, not in `site/`, so
only the owner can change them. After every deploy, the job Deploy asks the
live site for every file: on the `workers.dev` address, and on your own
domain if the variable `SITE_DOMAIN` names it. It fails unless each answer
has each header once, with exactly the value below. For an address that
does not exist, it only warns.

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
Cloudflare access and cannot change repository settings. Set up the
environment before the workflow runs on `main`: a run that names an
environment that does not exist creates it, with no protection.

Of the labels of the Cloudflare dashboard in these steps, only the
token's scope and role are confirmed. Write down any other label that
differs, so Claude can fix this page.

| What | Kind | Where |
|---|---|---|
| The Worker `shkriuss-hub` | Made by you, by hand | Cloudflare dashboard |
| `CLOUDFLARE_API_TOKEN` | Secret | Environment secret of the `cloudflare` environment on GitHub |
| `CLOUDFLARE_ACCOUNT_ID` | Not secret | Environment variable of the `cloudflare` environment on GitHub |
| `SITE_DOMAIN` | Not secret, optional | Environment variable of the `cloudflare` environment on GitHub, after you attach the domain ([Your domain](#6-your-domain)) |

None of these values goes into the repository or a Claude session. The account ID
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

The token in use was made this way: the scope **Specified Workers**,
`shkriuss-hub`, with the role **Editor**.

Every request that Wrangler 4.156.2 makes to deploy this configuration is
about the Worker itself. None is about a zone, a domain or another
Worker, as long as the Worker already has its `workers.dev` address,
which a Worker made in the dashboard has.

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

1. Open `github.com/shkriuss/shkriuss.app/actions/workflows/site.yml`, tap
   **Run workflow**, leave the branch at `main` and tap **Run workflow**.
   Every push to `main` also starts the workflow.
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

`SITE_DOMAIN` is set to `shkriuss.app`, so Deploy checks the domain too.

1. In **Workers & Pages**, tap `shkriuss-hub`.
2. Open **Settings**, then **Domains & Routes**. Tap **Add**, then
   **Custom Domain**.
3. Type `shkriuss.app` and tap **Add Custom Domain**.

The domain must be in the same Cloudflare account, and must not have a
CNAME record for that name. Cloudflare makes the DNS record and the
certificate. Every later deploy keeps the domain, and it serves the same
version as the `workers.dev` address.

Then let Deploy check the domain too:

4. Open `github.com/shkriuss/shkriuss.app/settings/environments` and tap
   `cloudflare`.
5. Under **Environment variables**, tap **Add environment variable**.
   Name: `SITE_DOMAIN`. Value: `shkriuss.app`, with no `https://` and no
   slash. Tap **Add variable**.
6. Open `github.com/shkriuss/shkriuss.app/actions/workflows/site.yml`, tap
   **Run workflow**, leave the branch at `main` and tap **Run workflow**.
7. When **Deploy** is green, its summary says "Checked the same way on your
   own domain".

Until `SITE_DOMAIN` is set, Deploy checks only the `workers.dev` address,
and its summary says that your own domain was not checked.

Your domain's zone settings can add headers of their own, for example
**HTTP Strict Transport Security** under **SSL/TLS**, **Edge
Certificates**. Then the domain sends that header twice, and Deploy fails
on the domain only. Turn that zone setting off: the site sends the header
itself.

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
| The variable SITE_DOMAIN of the cloudflare environment must be a plain domain name ... | Set it to the domain alone, for example `shkriuss.app`, with no `https://` and no slash ([Your domain](#6-your-domain), step 5). |
| ... does not send the header ... exactly as in _headers. | Cloudflare changed or added a header. The site is online, but not as strict as intended. If only your own domain fails, a zone setting adds the header ([Your domain](#6-your-domain)). Otherwise ask Claude, with the message. |
| The downloaded site is not the one the job Check the site checked. | Nothing was deployed. Run the workflow again. If it happens again, ask Claude. |
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
   `/index.html`, its `source`, and `nav`, the label in the menu. Leave
   out `nav` for a page that other pages link to but the menu does not
   show.
3. Link to other pages by their relative path, as everywhere in `docs/`.
4. Open a pull request. The job **Build** builds the site, and **Check
   the site** checks it.

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

1. Pick a Wrangler release that is more than a month old. Read its release
   notes. The owner accepted 4.156.2, 9 days old, as an exception, because
   no older release deploys with a per-Worker token
   ([ADR 0023](../adr/0023-hub-site-hosting-and-deploy.md)).
2. Change the version in `.github/site-deploy/package.json`.
3. In `.github/site-deploy/`, run
   `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`.
   It rewrites `package-lock.json`.
4. Check that `install.sh` installs it:
   `.github/site-deploy/install.sh /tmp/deploy`. It installs Wrangler
   only from the lockfile. It stops on a checksum that differs from the
   lockfile, and on a Node.js that is too old.
5. Open a pull request. The job **Deploy tool** installs it again on
   GitHub, and tries the deploy without uploading.

Prompt R5 in [PROMPTS.md](PROMPTS.md), the monthly updates, includes
these steps.
