# 0022 Hub site generator

- Status: Accepted
- Date: 2026-11-11
- Source: the owner's prompt for Phase 0, step 7
  ([PROMPTS.md](../development/PROMPTS.md)), and
  [plan](../plan/PLAN.md) sections 12, 14 and 17

## Context

- The hub site is built from `docs/` and `site/` (section 12). It shows
  the apps and their status, how to install them with Obtainium, how to
  verify them with AppVerifier against the signing fingerprint, and a link
  to the source ([0015](0015-distribution-channels.md)).
- It has no JavaScript, no fonts from other sites, no analytics and no
  cookies.
- The owner asked for "a generator that is one pinned, checksum-verified
  download, or a tiny script in the repository". Section 17 listed "a
  single pinned binary, no client-side JavaScript" as the item to confirm.
- The owner works from a phone. A change is checked by reading its diff on
  GitHub. The owner cannot run a tool to look at its output.
- The docs are written in GitHub's Markdown and are read on GitHub first.
  They use a small part of it: headings, paragraphs, lists with `-` and
  `1.`, fenced code, tables, code spans, bold, links and HTML comments. No
  images, block quotes, italics or raw HTML. Checked over all 62 Markdown
  files of the repository on 2026-11-11.
- The signing fingerprint lives in
  [fingerprints.md](../security/fingerprints.md). That file is owner-only,
  and the release workflow checks the form of its fingerprint line.
- GitHub's Ubuntu 24.04 runner comes with Python 3.12 (image 20261101).
  The cloud environment has Python 3.13.

## Decision

1. The generator is a script in the repository,
   [`tools/site/build.py`](../../tools/site/build.py). It uses only
   Python's standard library. The build downloads nothing.
2. It reads only the part of GitHub's Markdown that the docs use, listed
   in [site.md](../development/site.md#markdown-the-generator-reads). On
   anything else it stops with the file and the line. Examples: raw HTML,
   images, block quotes, tabs, indented code, `*` bullets, a list line
   that is not indented, link titles, `http://` links and HTML entities.
3. Raw HTML never reaches a page. All text is escaped.
4. Links:
   - A link to a page of the site goes to that page on the site.
   - A link to any other file of the repository goes to that file on
     GitHub, on `main`.
   - The file must exist. A link to a heading must name a heading that
     exists, with GitHub's anchor for it.
   - Links to other sites must use `https://`.
5. The verify page shows the fingerprint and each app's package name. The
   script reads them from `fingerprints.md`: the fingerprint line with the
   same pattern as the release workflow, and the table "Apps signed with
   this key". A page asks for them with the line
   `<!-- site: fingerprints -->`, which GitHub does not show.
6. [`site/site.json`](../../site/site.json) lists the pages and their
   Markdown sources. Every page uses
   [`site/template.html`](../../site/template.html) and one style sheet.
7. The tests in `tools/site/test_build.py` run before every build. The
   same commit always gives the same files.

## Options rejected

- **Hugo, a single pinned binary.** It is a large program with many
  features the site does not need. Its templates are a language of their
  own, and links to `.md` files need extra templates to work. It would be a
  download trusted on first use, and updated every month.
- **Zola, a single pinned binary.** It needs a block of settings at the
  top of every page. GitHub shows that block as text, so the docs would
  look wrong on GitHub.
- **Pandoc, a single pinned binary.** It reads all of GitHub's Markdown.
  It still needs a filter script for the links and the fingerprint, and a
  check for broken links. It is a large download trusted on first use. It
  is the fallback if the script becomes a burden.
- **A Markdown library from PyPI or npm.** A dependency with its own
  dependencies, which needs a lockfile and updates.
- **Pages written by hand in HTML.** The docs would exist twice and drift
  apart.

## Consequences

- There is nothing to download, pin, verify or update for the build, and
  nothing is trusted on first use.
- The script is not tiny. It has 751 lines, 603 of them code. It is the
  project's own code to maintain and test.
- A page that uses Markdown the script does not know fails the build. The
  script is extended in a pull request, with a test.
- On 2026-11-11 the script and pandoc 3.1.3 (GFM) gave the same structure
  and text for all 62 Markdown files of the repository. The only
  differences were intended: the fingerprint on the verify page, front
  matter in `.claude/rules/`, and an empty list item, which the script
  refuses. All 380 headings got the same anchors.
- The fingerprint on the site is the one the release workflow enforces. If
  `fingerprints.md` changes its form, the site build fails, like a release.
- Only the pages in `site.json` are on the site. Other docs are linked on
  GitHub.
- The Python version is the runner's and is not pinned. The tests passed
  on Python 3.11, 3.12 and 3.13.
- Hosting and deploying the site are in
  [0023](0023-hub-site-hosting-and-deploy.md).
