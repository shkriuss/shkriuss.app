"""Tests for build.py, the hub site generator.

Run them from the repository root:

    python3 -B -m unittest discover -s tools/site -t tools/site
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import build

FINGERPRINT = ":".join(f"{n:02X}" for n in range(32))
# How the site shows it: it may wrap only after a colon.
SHOWN = FINGERPRINT.replace(":", ":<wbr>")
FINGERPRINTS_MD = f"""# Signing certificate fingerprints

## Current certificate

Current certificate SHA-256: `{FINGERPRINT}`

## Apps signed with this key

| App | Package name |
|---|---|
| Catalog | `app.shkriuss.catalog` |
| Water | `app.shkriuss.water` |

## Previous certificates

None.
"""
TEMPLATE = "<title>$title</title><a href=/$home_current>$name</a><ul>$nav</ul><main>$content</main><p>$built</p>\n"


class Repository:
    """A small repository in a temporary folder, with one test page."""

    def __init__(self, files: dict[str, str] | None = None):
        self._folder = tempfile.TemporaryDirectory()
        self.root = Path(self._folder.name)
        base = {
            "site/template.html": TEMPLATE,
            "site/style.css": "body {}\n",
            "site/favicon.svg": "<svg></svg>\n",
            "site/index.md": "# Home\n",
            "site/404.md": "# Not found\n",
            "docs/user/page.md": "# Page\n",
            "docs/user/other.md": "# Other\n\n## Part two\n",
            "docs/notes.md": "# Notes\n\n## Kept on GitHub\n\n```text\n## Not a heading\n```\n",
            "docs/security/fingerprints.md": FINGERPRINTS_MD,
            "SECURITY.md": "# Security\n",
        }
        base.update(files or {})
        for name, text in base.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        self.config = {
            "name": "Test site",
            "repository": "https://github.com/owner/repo",
            "pages": [
                {"path": "index.html", "source": "site/index.md"},
                {"path": "page/index.html", "source": "docs/user/page.md", "nav": "Page"},
                {"path": "other/index.html", "source": "docs/user/other.md", "nav": "Other"},
                {"path": "404.html", "source": "site/404.md"},
            ],
            "links": [{"nav": "Source", "href": "https://github.com/owner/repo"}],
            "files": {"style.css": "site/style.css", "favicon.svg": "site/favicon.svg"},
        }

    def close(self) -> None:
        self._folder.cleanup()

    def site(self) -> build.Site:
        return build.Site(self.root, json.loads(json.dumps(self.config)))

    def write(self, name: str, text: str) -> None:
        (self.root / name).write_text(text, encoding="utf-8")


class RendererTest(unittest.TestCase):
    """Renders Markdown as the body of docs/user/page.md."""

    def setUp(self) -> None:
        self.repo = Repository()
        self.addCleanup(self.repo.close)

    def body(self, markdown: str) -> str:
        site = self.repo.site()
        renderer = build.PageRenderer(site, "docs/user/page.md")
        lines = list(enumerate(markdown.split("\n"), 1))
        return "\n".join(full for full, _, _ in build.parse_blocks(lines, renderer))

    def error(self, markdown: str) -> build.BuildError:
        with self.assertRaises(build.BuildError) as raised:
            self.body(markdown)
        return raised.exception


class InlineTest(RendererTest):
    def test_text_is_escaped(self):
        self.assertEqual(self.body("a < b & c > d \"e\" 'f'"), "<p>a &lt; b &amp; c &gt; d \"e\" 'f'</p>")

    def test_code_spans(self):
        self.assertEqual(self.body("`x <y> & z`"), "<p><code>x &lt;y&gt; &amp; z</code></p>")
        self.assertEqual(self.body("`` a`b ``"), "<p><code>a`b</code></p>")
        self.assertEqual(self.body("a ` b"), "<p>a ` b</p>")
        self.assertEqual(self.body("`**not bold**`"), "<p><code>**not bold**</code></p>")

    def test_bold_and_italic(self):
        self.assertEqual(self.body("**bold** and *it* and _it_"), "<p><strong>bold</strong> and <em>it</em> and <em>it</em></p>")
        self.assertEqual(self.body("**over a\nline break**"), "<p><strong>over a\nline break</strong></p>")
        self.assertEqual(self.body("snake_case_name and 2 * 3 * 4"), "<p>snake_case_name and 2 * 3 * 4</p>")

    def test_backslash_escapes(self):
        self.assertEqual(self.body(r"\*not\* \[a\] \`b\`"), "<p>*not* [a] `b`</p>")

    def test_links(self):
        self.assertEqual(self.body("[web](https://example.com/a?b=1&c=2)"), '<p><a href="https://example.com/a?b=1&amp;c=2">web</a></p>')
        self.assertEqual(self.body("[other](other.md)"), '<p><a href="/other/">other</a></p>')
        self.assertEqual(self.body("[part](other.md#part-two)"), '<p><a href="/other/#part-two">part</a></p>')
        self.assertEqual(self.body("[home](../../site/index.md)"), '<p><a href="/">home</a></p>')
        self.assertEqual(
            self.body("[notes](../notes.md#kept-on-github)"),
            '<p><a href="https://github.com/owner/repo/blob/main/docs/notes.md#kept-on-github">notes</a></p>',
        )
        self.assertEqual(self.body("[docs](../)"), '<p><a href="https://github.com/owner/repo/tree/main/docs">docs</a></p>')
        self.assertEqual(self.body("[`code` **bold**](other.md)"), '<p><a href="/other/"><code>code</code> <strong>bold</strong></a></p>')

    def test_autolinks(self):
        self.assertEqual(self.body("<https://example.com/x>"), '<p><a href="https://example.com/x">https://example.com/x</a></p>')
        self.assertEqual(
            self.body("See https://example.com/a_(b). Then"),
            '<p>See <a href="https://example.com/a_(b)">https://example.com/a_(b)</a>. Then</p>',
        )
        self.assertEqual(self.body("(https://example.com)"), '<p>(<a href="https://example.com">https://example.com</a>)</p>')

    def test_inline_errors(self):
        cases = {
            "a <b>bold</b>": "Raw HTML",
            "a <!-- x --> b": "Raw HTML",
            "![image](x.png)": "Images",
            "[a](http://example.com)": "Only https://",
            "http://example.com": "https:// links only",
            "[mail](mailto:a@example.com)": "Only https://",
            "[gone](missing.md)": "No file or folder docs/user/missing.md",
            "[out](../../../x.md)": "leaves the repository",
            "[q](other.md?x=1)": "without ? or %",
            "[t](other.md \"title\")": "Link titles",
            "&copy; 2026": "HTML entities",
            "[[a](other.md)](page.md)": "cannot contain another link",
        }
        for markdown, message in cases.items():
            with self.subTest(markdown=markdown):
                self.assertIn(message, self.error(markdown).message)

    def test_error_names_the_line(self):
        error = self.error("# Page\n\nfirst line\nsecond <b> line")
        self.assertEqual((error.path, error.line), ("docs/user/page.md", 4))


class BlockTest(RendererTest):
    def test_headings_get_github_anchors(self):
        html = self.body("## Job \"Gradle wrapper\"\n\n## A `code` heading!\n\n## Again\n\n## Again ##")
        self.assertIn('<h2 id="job-gradle-wrapper">Job "Gradle wrapper"</h2>', html)
        self.assertIn('<h2 id="a-code-heading">A <code>code</code> heading!</h2>', html)
        self.assertIn('<h2 id="again">Again</h2>', html)
        self.assertIn('<h2 id="again-1">Again</h2>', html)

    def test_paragraphs(self):
        self.assertEqual(self.body("one\n  two\n\nthree"), "<p>one\ntwo</p>\n<p>three</p>")

    def test_tight_list(self):
        self.assertEqual(self.body("- a\n- b\n  more"), "<ul>\n<li>a</li>\n<li>b\nmore</li>\n</ul>")

    def test_loose_list(self):
        self.assertEqual(self.body("- a\n\n- b"), "<ul>\n<li><p>a</p></li>\n<li><p>b</p></li>\n</ul>")
        self.assertEqual(self.body("1. a\n\n   b"), "<ol>\n<li><p>a</p>\n<p>b</p></li>\n</ol>")

    def test_nested_and_numbered_lists(self):
        html = self.body("3. a\n   - b\n\n     c\n   - d\n4. e")
        self.assertEqual(
            html,
            '<ol start="3">\n<li>a\n<ul>\n<li><p>b</p>\n<p>c</p></li>\n<li><p>d</p></li>\n</ul></li>\n<li>e</li>\n</ol>',
        )

    def test_list_after_paragraph_and_paragraph_after_list(self):
        self.assertEqual(self.body("Steps:\n- a\n\nAfter."), "<p>Steps:</p>\n<ul>\n<li>a</li>\n</ul>\n<p>After.</p>")

    def test_list_errors(self):
        cases = {
            "* a": "Start bullet points with -",
            "1) a": "Number list items",
            "- a\nlazy": "Indent this line",
            "1.": "Empty list items",
        }
        for markdown, message in cases.items():
            with self.subTest(markdown=markdown):
                self.assertIn(message, self.error(markdown).message)

    def test_table(self):
        html = self.body("| A | B | C |\n|:---|:---:|---:|\n| `a\\|b` | **x** | [o](other.md) |")
        self.assertEqual(
            html,
            '<div class="table"><table>\n<thead>\n'
            '<tr><th class="left">A</th><th class="center">B</th><th class="right">C</th></tr>\n'
            "</thead>\n<tbody>\n"
            '<tr><td class="left"><code>a|b</code></td><td class="center"><strong>x</strong></td>'
            '<td class="right"><a href="/other/">o</a></td></tr>\n'
            "</tbody>\n</table></div>",
        )

    def test_table_errors(self):
        self.assertIn("2 cells", self.error("| A | B | C |\n|---|---|---|\n| a | b |").message)
        self.assertIn("same number of cells", self.error("| A | B |\n|---|\n").message)
        self.assertIn("blank line before a table", self.error("Text\n| A |\n|---|").message)
        self.assertIn("End a table", self.error("| A |\n|---|\n| a |\nno pipe").message)

    def test_fenced_code(self):
        self.assertEqual(self.body("```bash\necho \"<hi>\" & \\\n\n  x\n```"), '<pre><code>echo "&lt;hi&gt;" &amp; \\\n\n  x\n</code></pre>')
        self.assertEqual(self.body("1. a\n\n   ```text\n   b\n     c\n   ```"), "<ol>\n<li><p>a</p>\n<pre><code>b\n  c\n</code></pre></li>\n</ol>")
        self.assertEqual(self.body("````\n```\n````"), "<pre><code>```\n</code></pre>")

    def test_comments_are_left_out(self):
        self.assertEqual(self.body("a\n\n<!-- hidden\nstill hidden -->\n\nb"), "<p>a</p>\n<p>b</p>")

    def test_rule(self):
        self.assertEqual(self.body("a\n\n---\n\nb"), "<p>a</p>\n<hr>\n<p>b</p>")

    def test_block_errors(self):
        cases = {
            "    indented": "Indented code blocks",
            "\ttab": "tabs",
            "> quote": "Block quotes",
            "<div>x</div>": "Raw HTML",
            "Title\n=====": "Underlined headings",
            "a\\\nb": "backslash",
            "```\nnot closed": "no closing fence",
            "``` bash x\n```": "only a language name",
            "<!-- not closed": "not closed",
            "<!-- a --> b": "nothing after -->",
            "<!-- site: other -->": "Unknown site directive",
            "<!-- site:\nfingerprints -->x": "nothing after -->",
            "#": "empty",
        }
        for markdown, message in cases.items():
            with self.subTest(markdown=markdown):
                self.assertIn(message, self.error(markdown).message)


class FingerprintTest(RendererTest):
    def test_directive_shows_the_fingerprint_and_each_app(self):
        html = self.body("<!-- site: fingerprints -->")
        self.assertIn(f"<p><code>{SHOWN}</code></p>", html)
        self.assertIn(f"<p><strong>Catalog</strong></p>\n<pre><code>app.shkriuss.catalog\n{SHOWN}\n</code></pre>", html)
        self.assertIn(f"<pre><code>app.shkriuss.water\n{SHOWN}\n</code></pre>", html)
        self.assertNotIn(FINGERPRINT, html)

    def check_fails(self, text: str, message: str) -> None:
        self.repo.write("docs/security/fingerprints.md", text)
        with self.assertRaises(build.BuildError) as raised:
            build.fingerprints_markdown(self.repo.root)
        self.assertEqual(raised.exception.path, "docs/security/fingerprints.md")
        self.assertIn(message, raised.exception.message)

    def test_the_line_must_have_the_release_workflow_form(self):
        line = f"Current certificate SHA-256: `{FINGERPRINT}`"
        self.check_fails(FINGERPRINTS_MD.replace(line, line.lower().replace("current certificate sha-256", "Current certificate SHA-256")), "Expected exactly one line")
        self.check_fails(FINGERPRINTS_MD.replace(line, line + "\n" + line), "Expected exactly one line")
        self.check_fails(FINGERPRINTS_MD.replace(line, line[:-4] + "`"), "Expected exactly one line")
        self.check_fails(FINGERPRINTS_MD.replace(line, "No fingerprint."), "Expected exactly one line")

    def test_the_apps_table_must_be_readable(self):
        self.check_fails(FINGERPRINTS_MD.replace("`app.shkriuss.water`", "app.shkriuss.water"), "Expected a row")
        self.check_fails(FINGERPRINTS_MD.replace("## Apps signed with this key", "## Apps"), "Found no apps")


class SiteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = Repository()
        self.addCleanup(self.repo.close)

    def build_error(self, commit: str | None = None) -> build.BuildError:
        with self.assertRaises(build.BuildError) as raised:
            self.repo.site().build(commit)
        return raised.exception

    def test_files_titles_and_navigation(self):
        files = self.repo.site().build("0123456789abcdef0123456789abcdef01234567")
        self.assertEqual(sorted(files), ["404.html", "favicon.svg", "index.html", "other/index.html", "page/index.html", "style.css"])
        page = files["page/index.html"].decode()
        self.assertIn("<title>Page · Test site</title>", page)
        self.assertIn('<li><a href="/page/" aria-current="page">Page</a></li>', page)
        self.assertIn('<li><a href="/other/">Other</a></li>', page)
        self.assertIn('<li><a href="https://github.com/owner/repo">Source</a></li>', page)
        self.assertIn('/commit/0123456789abcdef0123456789abcdef01234567"><code>0123456</code></a>', page)
        self.assertIn('<a href=/ aria-current="page">Test site</a>', files["index.html"].decode())
        self.assertNotIn("aria-current", files["404.html"].decode())

    def test_the_title_equal_to_the_site_name_stands_alone(self):
        self.repo.write("site/index.md", "# Test site\n")
        self.assertIn("<title>Test site</title>", self.repo.site().build()["index.html"].decode())

    def test_the_build_is_the_same_every_time(self):
        self.assertEqual(self.repo.site().build(), self.repo.site().build())

    def test_a_page_has_exactly_one_title_at_the_top(self):
        for text in ("Intro\n\n# Page\n", "# Page\n\n# Again\n", "## Page\n"):
            with self.subTest(text=text):
                self.repo.write("docs/user/page.md", text)
                self.assertIn("starts with one # heading", self.build_error().message)

    def test_anchors_are_checked(self):
        cases = {
            "[x](#nowhere)": "docs/user/page.md has no heading for the link #nowhere",
            "[x](other.md#nowhere)": "docs/user/other.md has no heading",
            "[x](../notes.md#not-a-heading)": "docs/notes.md has no heading",
        }
        for link, message in cases.items():
            with self.subTest(link=link):
                self.repo.write("docs/user/page.md", f"# Page\n\n{link}\n")
                error = self.build_error()
                self.assertEqual((error.path, error.line), ("docs/user/page.md", 3))
                self.assertIn(message, error.message)
        self.repo.write("docs/user/page.md", "# Page\n\n[x](#page) [y](other.md#part-two)\n")
        self.repo.site().build()

    def test_the_commit_must_be_a_full_sha(self):
        self.assertIn("40 lower-case hex digits", self.build_error("abc").message)

    def test_the_configuration_is_checked(self):
        changes = [
            ("pages", [p for p in self.repo.config["pages"] if p["path"] != "404.html"], "404.html"),
            ("pages", self.repo.config["pages"] + [{"path": "Bad.html", "source": "site/index.md"}], "own path and its own source"),
            ("pages", self.repo.config["pages"] + [{"path": "x.htm", "source": "docs/notes.md"}], "ending in .html"),
            ("pages", self.repo.config["pages"] + [{"path": "x.html", "source": "docs/missing.md"}], "No Markdown file"),
            ("files", {"x.js": "site/style.css"}, ".css or .svg"),
            ("links", [{"nav": "X", "href": "http://example.com"}], "https://"),
            ("repository", "https://example.com/owner/repo", "github.com"),
        ]
        for key, value, message in changes:
            with self.subTest(key=key, message=message):
                config = json.loads(json.dumps(self.repo.config))
                config[key] = value
                with self.assertRaises(build.BuildError) as raised:
                    build.Site(self.repo.root, config)
                self.assertIn(message, raised.exception.message)

    def test_output_goes_only_into_a_new_or_empty_folder(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "site"
            build.write_site({"a/index.html": b"x"}, output)
            self.assertEqual((output / "a/index.html").read_bytes(), b"x")
            with self.assertRaises(build.BuildError):
                build.write_site({"b.html": b"y"}, output)

    def test_annotations_cannot_add_workflow_commands(self):
        error = build.BuildError("a:b,c.md", 3, "50% bad\n::warning::injected")
        self.assertEqual(build.annotation(error), "::error file=a%3Ab%2Cc.md,line=3::50%25 bad%0A::warning::injected")


class RealSiteTest(unittest.TestCase):
    """Builds the real site from this repository."""

    def test_the_real_site_builds(self):
        config = json.loads((build.ROOT / build.CONFIG).read_text(encoding="utf-8"))
        first = build.Site(build.ROOT, config).build("0" * 40)
        second = build.Site(build.ROOT, config).build("0" * 40)
        self.assertEqual(first, second)
        for name, data in first.items():
            with self.subTest(name=name):
                text = data.decode("utf-8").lower()
                self.assertNotIn("<script", text)
                self.assertNotIn("javascript:", text)
        verify = first["verify/index.html"].decode()
        fingerprints = (build.ROOT / build.FINGERPRINTS).read_text(encoding="utf-8")
        line = next(t for t in fingerprints.split("\n") if t.startswith("Current certificate SHA-256:"))
        shown = build.FINGERPRINT_LINE.match(line)[1].replace(":", ":<wbr>")
        self.assertIn(f"<code>{shown}</code>", verify)


if __name__ == "__main__":
    unittest.main()
