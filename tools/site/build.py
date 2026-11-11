#!/usr/bin/env python3
"""Builds the hub website from docs/ and site/.

Usage, from the repository root:

    python3 tools/site/build.py [--commit SHA] OUTPUT_FOLDER

site/site.json lists the pages. Each page is one Markdown file from docs/ or
site/. This script turns each one into an HTML page with site/template.html
and copies the style sheet and the icon. It needs only Python's standard
library, so the build downloads nothing. Why: docs/adr/0022-hub-site-generator.md.

It reads only the part of GitHub's Markdown that the docs use (listed in
docs/development/site.md). Anything else stops the build with the file and
the line, so a page never looks different from GitHub without anyone
noticing. Raw HTML in a page is never copied into the site.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import posixpath
import re
import string
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = "site/site.json"
FINGERPRINTS = "docs/security/fingerprints.md"


class BuildError(Exception):
    """A problem in a source file, with the file and line where it is."""

    def __init__(self, path: str, line: int, message: str):
        super().__init__(f"{path}:{line}: {message}")
        self.path, self.line, self.message = path, line, message


def esc(text: str) -> str:
    """Escapes text for an HTML attribute value."""
    return html.escape(text, quote=True)


def esc_text(text: str) -> str:
    """Escapes text for HTML content."""
    return html.escape(text, quote=False)


# Inline Markdown: code, links, bold and italic.

PUNCTUATION = frozenset("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")
BACKTICKS = re.compile(r"`+")
AUTOLINK = re.compile(r"<(https://[^\s<>]+)>")
BARE_URL = re.compile(r"https?://[^\s<]+")
ENTITY = re.compile(r"&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});")
RAW_HTML = re.compile(r"</?[A-Za-z]|<[!?]")
# Bold and italic may run over a line break, so "." matches it too.
STRONG = (
    re.compile(r"\*\*(?=[^\s*])(.+?)(?<=[^\s*])\*\*", re.DOTALL),
    re.compile(r"(?<![\w_])__(?=[^\s_])(.+?)(?<=[^\s_])__(?![\w_])", re.DOTALL),
)
EMPHASIS = (
    re.compile(r"(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])", re.DOTALL),
    re.compile(r"(?<![\w_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\w_])", re.DOTALL),
)
TOKEN = re.compile("\x00(\\d+)\x00")


def closing_backticks(text: str, run: re.Match) -> re.Match | None:
    """Finds the backticks that close the code span opened by `run`."""
    length = run.end() - run.start()
    pattern = re.compile(r"(?<!`)`{%d}(?!`)" % length)
    return pattern.search(text, run.end())


def trim_url(url: str) -> str:
    """Drops punctuation at the end of a bare URL, as GitHub does."""
    while url and url[-1] in "?!.,:*_~'\"":
        url = url[:-1]
    while url.endswith(")") and url.count(")") > url.count("("):
        url = url[:-1]
    return url


def parse_link(text: str, start: int, fail) -> tuple[str, str, int] | None:
    """Reads [label](destination) at `start`. Returns None if it is not a link."""
    depth, i = 0, start
    while i < len(text):
        ch = text[i]
        if ch == "\\":
            i += 2
            continue
        if ch == "`":
            run = BACKTICKS.match(text, i)
            close = closing_backticks(text, run)
            i = close.end() if close else run.end()
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                break
        i += 1
    else:
        return None
    if not text.startswith("(", i + 1):
        return None
    j = k = i + 2
    if text.startswith("<", j):
        k = text.find(">", j)
        if k < 0:
            return None
        destination, k = text[j + 1 : k], k + 1
    else:
        parens = 0
        while k < len(text) and not text[k].isspace():
            if text[k] == "(":
                parens += 1
            elif text[k] == ")":
                if parens == 0:
                    break
                parens -= 1
            k += 1
        destination = text[j:k]
    if not text.startswith(")", k):
        fail(k, "Link titles are not supported. Write [text](destination) only.")
    if not destination:
        fail(j, "This link has no destination.")
    return text[start + 1 : i], destination, k + 1


def render_inline(text: str, page: "PageRenderer", line: int, in_link: bool = False) -> str:
    """Turns the text of one paragraph, heading or table cell into HTML."""
    tokens: list[str] = []
    parts: list[str] = []

    def keep(fragment: str) -> None:
        tokens.append(fragment)
        parts.append(f"\x00{len(tokens) - 1}\x00")

    def line_at(index: int) -> int:
        return line + text.count("\n", 0, index)

    def fail(index: int, message: str):
        page.fail(line_at(index), message)

    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "\\" and i + 1 < len(text) and text[i + 1] in PUNCTUATION:
            keep(esc_text(text[i + 1]))
            i += 2
        elif ch == "`":
            run = BACKTICKS.match(text, i)
            close = closing_backticks(text, run)
            if close is None:
                parts.append(run.group())
                i = run.end()
                continue
            code = text[run.end() : close.start()].replace("\n", " ")
            if len(code) >= 2 and code[0] == code[-1] == " " and code.strip():
                code = code[1:-1]
            keep(f"<code>{esc_text(code)}</code>")
            i = close.end()
        elif ch == "<" and (auto := AUTOLINK.match(text, i)) and not in_link:
            href = page.link(auto[1], line_at(i))
            keep(f'<a href="{esc(href)}">{esc_text(auto[1])}</a>')
            i = auto.end()
        elif ch == "<" and RAW_HTML.match(text, i):
            fail(i, "Raw HTML is not allowed. Put it in backticks, or write it in Markdown.")
        elif text.startswith("![", i):
            fail(i, "Images are not supported.")
        elif ch == "[" and (link := parse_link(text, i, fail)) is not None:
            if in_link:
                fail(i, "A link cannot contain another link.")
            label, destination, end = link
            inner = render_inline(label, page, line_at(i), in_link=True)
            keep(f'<a href="{esc(page.link(destination, line_at(i)))}">{inner}</a>')
            i = end
        elif (
            ch == "h"
            and not in_link
            and (i == 0 or text[i - 1] in " \n*_~(")
            and (bare := BARE_URL.match(text, i))
        ):
            url = trim_url(bare.group())
            if url.startswith("http://"):
                fail(i, "Use https:// links only.")
            keep(f'<a href="{esc(page.link(url, line_at(i)))}">{esc_text(url)}</a>')
            i += len(url)
        elif ch == "&" and ENTITY.match(text, i):
            fail(i, "HTML entities are not supported. Write the character itself.")
        else:
            parts.append(ch)
            i += 1

    out = esc_text("".join(parts))
    for pattern in STRONG:
        out = pattern.sub(r"<strong>\1</strong>", out)
    for pattern in EMPHASIS:
        out = pattern.sub(r"<em>\1</em>", out)
    return TOKEN.sub(lambda m: tokens[int(m[1])], out)


def plain_text(fragment: str) -> str:
    """The text of an HTML fragment, without its tags."""
    return html.unescape(re.sub(r"<[^>]*>", "", fragment))


def slug(text: str) -> str:
    """The anchor GitHub gives a heading with this text."""
    kept = "".join(
        ch for ch in text.lower() if ch in " -_" or unicodedata.category(ch)[0] in "LNM"
    )
    return kept.replace(" ", "-")


# Block Markdown: headings, paragraphs, lists, tables and code blocks.

FENCE = re.compile(r"^( {0,3})(`{3,}|~{3,})(.*)$")
HEADING = re.compile(r"^ {0,3}(#{1,6})(?= |$) *(.*?)(?: +#+)? *$")
RULE = re.compile(r"^ {0,3}(?:(?:- *){3,}|(?:\* *){3,}|(?:_ *){3,})$")
LIST_ITEM = re.compile(r"^( {0,3})(?:([-*+])|(\d{1,9})([.)]))( +|$)(.*)$")
TABLE_DELIMITER = re.compile(r"^ {0,3}\|?(?: *:?-+:? *\|)*(?: *:?-+:? *)\|? *$")
SETEXT = re.compile(r"^ {0,3}(?:=+|-+) *$")
DIRECTIVE = re.compile(r"<!--\s*site:\s*([a-z-]+)\s*-->")

# One parsed block: its HTML, its HTML inside a tight list (paragraphs
# only, otherwise None), and whether a blank line came before it.
Block = tuple[str, "str | None", bool]
Lines = list[tuple[int, str]]


def indent_of(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def interrupts_paragraph(line: str) -> bool:
    """True if the line starts a new block even right after a paragraph."""
    item = LIST_ITEM.match(line)
    return bool(
        FENCE.match(line)
        or HEADING.match(line)
        or RULE.match(line)
        or line.lstrip(" ").startswith(("<!--", ">"))
        or (item and item[6].strip() and (item[2] or item[3] == "1"))
    )


def parse_blocks(lines: Lines, page: "PageRenderer") -> list[Block]:
    """Parses lines whose container indent has already been removed."""
    blocks: list[Block] = []
    i, blank = 0, False
    while i < len(lines):
        if not lines[i][1].strip():
            blank, i = True, i + 1
            continue
        i, block_html, tight = parse_block(lines, i, page)
        if block_html:
            blocks.append((block_html, tight, blank and bool(blocks)))
            blank = False
    return blocks


def parse_block(lines: Lines, i: int, page: "PageRenderer") -> tuple[int, str, str | None]:
    """Parses the block that starts at line i. Returns the next line and the block."""
    number, line = lines[i]
    if FENCE.match(line):
        return parse_fence(lines, i, page)
    if "\t" in line:
        page.fail(number, "Use spaces, not tabs.")
    if indent_of(line) >= 4:
        page.fail(number, "Indented code blocks are not supported. Use a fence (```).")
    stripped = line.strip()
    if stripped.startswith("<!--"):
        return parse_comment(lines, i, page)
    if heading := HEADING.match(line):
        return i + 1, render_heading(heading, number, page), None
    if RULE.match(line):
        return i + 1, "<hr>", None
    if LIST_ITEM.match(line):
        return parse_list(lines, i, page)
    if "|" in line and i + 1 < len(lines) and TABLE_DELIMITER.match(lines[i + 1][1]):
        return parse_table(lines, i, page)
    if stripped.startswith(">"):
        page.fail(number, "Block quotes are not supported.")
    if RAW_HTML.match(stripped) and not AUTOLINK.match(stripped):
        page.fail(number, "Raw HTML is not allowed. Put it in backticks, or write it in Markdown.")
    return parse_paragraph(lines, i, page)


def render_heading(match: re.Match, number: int, page: "PageRenderer") -> str:
    level, text = len(match[1]), match[2].strip()
    if not text:
        page.fail(number, "This heading is empty.")
    inner = render_inline(text, page, number)
    if level == 1:
        page.titles.append((number, plain_text(inner)))
    return f'<h{level} id="{esc(page.heading_id(inner))}">{inner}</h{level}>'


def parse_paragraph(lines: Lines, i: int, page: "PageRenderer") -> tuple[int, str, str]:
    first = lines[i][0]
    texts: list[str] = []
    while i < len(lines):
        number, line = lines[i]
        if not line.strip() or (texts and interrupts_paragraph(line)):
            break
        if texts and SETEXT.match(line):
            page.fail(number, "Underlined headings are not supported. Use # headings.")
        if texts and "|" in line and i + 1 < len(lines) and TABLE_DELIMITER.match(lines[i + 1][1]):
            page.fail(number, "Put a blank line before a table.")
        if "\t" in line:
            page.fail(number, "Use spaces, not tabs.")
        if line.rstrip().endswith("\\"):
            page.fail(number, "Line breaks with a backslash are not supported.")
        texts.append(line.strip())
        i += 1
    inner = render_inline("\n".join(texts), page, first)
    return i, f"<p>{inner}</p>", inner


def parse_fence(lines: Lines, i: int, page: "PageRenderer") -> tuple[int, str, None]:
    number, line = lines[i]
    match = FENCE.match(line)
    indent, fence, info = len(match[1]), match[2], match[3].strip()
    if info and not re.fullmatch(r"[A-Za-z0-9_+-]+", info):
        page.fail(number, "After a fence, write only a language name, such as ```bash.")
    close = re.compile(r"^ {0,3}%s{%d,} *$" % (re.escape(fence[0]), len(fence)))
    body: list[str] = []
    for j in range(i + 1, len(lines)):
        if close.match(lines[j][1]):
            code = "".join(text[min(indent, indent_of(text)) :] + "\n" for text in body)
            return j + 1, f"<pre><code>{esc_text(code)}</code></pre>", None
        body.append(lines[j][1])
    page.fail(number, "This code block has no closing fence.")


def parse_comment(lines: Lines, i: int, page: "PageRenderer") -> tuple[int, str, None]:
    number = lines[i][0]
    j = i
    while "-->" not in lines[j][1]:
        j += 1
        if j == len(lines):
            page.fail(number, "This HTML comment is not closed.")
    if lines[j][1].split("-->", 1)[1].strip():
        page.fail(lines[j][0], "Put nothing after --> on the line that ends a comment.")
    comment = "\n".join(text for _, text in lines[i : j + 1]).strip()
    if directive := DIRECTIVE.fullmatch(comment):
        return j + 1, page.directive(directive[1], number), None
    if re.match(r"<!--\s*site:", comment):
        page.fail(number, "Write a site directive on its own line, as <!-- site: name -->.")
    return j + 1, "", None


def parse_list(lines: Lines, i: int, page: "PageRenderer") -> tuple[int, str, None]:
    first = LIST_ITEM.match(lines[i][1])
    ordered = first[3] is not None
    items: list[list[Block]] = []
    loose = False
    while i < len(lines):
        number, line = lines[i]
        item = LIST_ITEM.match(line)
        if not item or (item[3] is not None) != ordered or RULE.match(line):
            break
        if item[2] and item[2] != "-":
            page.fail(number, "Start bullet points with -.")
        if item[4] and item[4] != ".":
            page.fail(number, "Number list items as 1. 2. 3.")
        if not item[6].strip():
            page.fail(number, "Empty list items are not supported.")
        if len(item[5]) > 4:
            page.fail(number, "Put one space after a list marker.")
        column = len(item[0]) - len(item[6])
        item_lines: Lines = [(number, item[6])]
        i += 1
        while i < len(lines):
            number, line = lines[i]
            if not line.strip():
                item_lines.append((number, ""))
            elif indent_of(line) >= column:
                item_lines.append((number, line[column:]))
            else:
                break
            i += 1
        trailing = 0
        while not item_lines[-1][1]:
            item_lines.pop()
            trailing += 1
        blocks = parse_blocks(item_lines, page)
        loose = loose or any(blank for _, _, blank in blocks)
        items.append(blocks)
        if i == len(lines):
            break
        number, line = lines[i]
        following = LIST_ITEM.match(line)
        if following and (following[3] is not None) == ordered and not RULE.match(line):
            loose = loose or trailing > 0
            continue
        if not trailing and not interrupts_paragraph(line):
            page.fail(
                number,
                "Indent this line to line up with the text of the list item above, "
                "or put a blank line before it.",
            )
        # The blank lines after the list belong to the container around it.
        i -= trailing
        break
    tag = "ol" if ordered else "ul"
    start = f' start="{int(first[3])}"' if ordered and int(first[3]) != 1 else ""
    rendered = []
    for blocks in items:
        parts = [tight if tight is not None and not loose else full for full, tight, _ in blocks]
        rendered.append("<li>" + "\n".join(parts) + "</li>")
    return i, f"<{tag}{start}>\n" + "\n".join(rendered) + f"\n</{tag}>", None


def split_cells(line: str) -> list[str]:
    """The cells of a table row. A pipe written as \\| stays in its cell."""
    text = line.strip()
    if text.startswith("|"):
        text = text[1:]
    if text.endswith("|") and not text.endswith("\\|"):
        text = text[:-1]
    return [cell.strip().replace("\\|", "|") for cell in re.split(r"(?<!\\)\|", text)]


def parse_table(lines: Lines, i: int, page: "PageRenderer") -> tuple[int, str, None]:
    number, line = lines[i]
    header = split_cells(line)
    aligns = []
    for cell in split_cells(lines[i + 1][1]):
        left, right = cell.startswith(":"), cell.endswith(":")
        aligns.append("center" if left and right else "right" if right else "left" if left else "")
    if len(aligns) != len(header):
        page.fail(number, "The header row and the row of dashes under it need the same number of cells.")

    def row(tag: str, cells: list[str], row_number: int) -> str:
        out = []
        for cell, align in zip(cells, aligns):
            attribute = f' class="{align}"' if align else ""
            out.append(f"<{tag}{attribute}>{render_inline(cell, page, row_number)}</{tag}>")
        return "<tr>" + "".join(out) + "</tr>"

    body = []
    j = i + 2
    while j < len(lines) and lines[j][1].strip() and not interrupts_paragraph(lines[j][1]):
        row_number, text = lines[j]
        if "|" not in text:
            page.fail(row_number, "End a table with a blank line.")
        cells = split_cells(text)
        if len(cells) != len(header):
            page.fail(row_number, f"This row has {len(cells)} cells. The table has {len(header)} columns.")
        body.append(row("td", cells, row_number))
        j += 1
    out = ['<div class="table"><table>', "<thead>", row("th", header, number), "</thead>"]
    if body:
        out += ["<tbody>", *body, "</tbody>"]
    out.append("</table></div>")
    return j, "\n".join(out), None


# Pages and the site.


class Page:
    """One HTML page of the site, and the Markdown file it is made from."""

    def __init__(self, path: str, source: str, nav: str | None):
        self.path, self.source, self.nav = path, source, nav
        self.url = "/" + (path[: -len("index.html")] if path.endswith("index.html") else path)


class PageRenderer:
    """Renders one Markdown file. Keeps its heading anchors and resolves its links."""

    def __init__(self, site: "Site", source: str, check_links: bool = True):
        self.site, self.source, self.check_links = site, source, check_links
        self.anchors: dict[str, int] = {}
        self.titles: list[tuple[int, str]] = []

    def fail(self, line: int, message: str):
        raise BuildError(self.source, line, message)

    def heading_id(self, inner_html: str) -> str:
        """The next anchor for a heading, numbered like GitHub's for repeated headings."""
        base = slug(plain_text(inner_html))
        anchor = base
        while anchor in self.anchors:
            self.anchors[base] += 1
            anchor = f"{base}-{self.anchors[base]}"
        self.anchors[anchor] = 0
        return anchor

    def link(self, destination: str, line: int) -> str:
        if not self.check_links:
            return "#"
        return self.site.resolve(self.source, destination, line)

    def directive(self, name: str, line: int) -> str:
        if name != "fingerprints":
            self.fail(line, f"Unknown site directive: {name}. The only one is fingerprints.")
        markdown = fingerprints_markdown(self.site.root)
        blocks = parse_blocks([(line, text) for text in markdown], self)
        # A long fingerprint may wrap only after a colon, never inside a
        # pair. <wbr> adds no character, so copied text stays exact.
        return FINGERPRINT.sub(
            lambda match: match[0].replace(":", ":<wbr>"),
            "\n".join(full for full, _, _ in blocks),
        )


FINGERPRINT_LINE = re.compile(r"^Current certificate SHA-256: `([0-9A-F]{2}(?::[0-9A-F]{2}){31})`$")
FINGERPRINT = re.compile(r"[0-9A-F]{2}(?::[0-9A-F]{2}){31}")
APP_ROW = re.compile(r"^\| *([A-Z][A-Za-z0-9 ]*?) *\| *`(app\.shkriuss\.[a-z][a-z0-9]*)` *\| *$")
APPS_HEADING = "## Apps signed with this key"


def fingerprints_markdown(root: Path) -> list[str]:
    """The fingerprint and each app's AppVerifier text, read from fingerprints.md.

    The fingerprint line has the form that the release workflow checks.
    """
    lines = (root / FINGERPRINTS).read_text(encoding="utf-8").split("\n")
    found = [(n, text) for n, text in enumerate(lines, 1) if text.startswith("Current certificate SHA-256:")]
    if len(found) != 1 or not FINGERPRINT_LINE.match(found[0][1]):
        raise BuildError(
            FINGERPRINTS,
            found[0][0] if found else 1,
            "Expected exactly one line of the form: Current certificate SHA-256: `AA:BB:...` "
            "(32 pairs of upper-case hex digits).",
        )
    fingerprint = FINGERPRINT_LINE.match(found[0][1])[1]
    apps, in_section = [], False
    for n, text in enumerate(lines, 1):
        if text.startswith("#"):
            in_section = text.rstrip() == APPS_HEADING
        elif in_section and text.startswith("|"):
            if row := APP_ROW.match(text):
                apps.append((row[1], row[2]))
            elif not (text.startswith("| App |") or TABLE_DELIMITER.match(text)):
                raise BuildError(FINGERPRINTS, n, "Expected a row of the form: | Name | `app.shkriuss.name` |")
    if not apps:
        raise BuildError(FINGERPRINTS, 1, f'Found no apps under "{APPS_HEADING}".')
    markdown = [
        "SHA-256 fingerprint of the certificate that signs every app:",
        "",
        f"`{fingerprint}`",
        "",
        "Each app's package name and the fingerprint, in the form AppVerifier reads:",
        "",
    ]
    for name, package in apps:
        markdown += [f"**{name}**", "", "```text", package, fingerprint, "```", ""]
    return markdown


class Site:
    """The whole site: its pages, its files and the links between them."""

    def __init__(self, root: Path, config: dict):
        self.root = root
        self.name = config["name"]
        self.repository = config["repository"].rstrip("/")
        if not re.fullmatch(r"https://github\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+", self.repository):
            raise BuildError(CONFIG, 1, "repository must be a https://github.com/owner/name address.")
        self.pages = [Page(p["path"], p["source"], p.get("nav")) for p in config["pages"]]
        self.links = [(link["nav"], link["href"]) for link in config.get("links", [])]
        self.files = dict(config.get("files", {}))
        self.by_source = {page.source: page for page in self.pages}
        self.page_anchors: dict[str, dict[str, int]] = {}
        self.anchor_checks: list[tuple[str, int, str, str]] = []
        self._file_anchors: dict[str, dict[str, int]] = {}
        self._check_config()

    def _check_config(self) -> None:
        paths = [page.path for page in self.pages] + list(self.files)
        if len(set(paths)) != len(paths) or len(self.by_source) != len(self.pages):
            raise BuildError(CONFIG, 1, "Every page needs its own path and its own source.")
        if "index.html" not in paths or "404.html" not in paths:
            raise BuildError(CONFIG, 1, "The site needs the pages index.html and 404.html.")
        for page in self.pages:
            if not re.fullmatch(r"([a-z0-9-]+/)*[a-z0-9-]+\.html", page.path):
                raise BuildError(CONFIG, 1, f"Page paths are lower-case names ending in .html: {page.path}")
            if not page.source.endswith(".md") or not (self.root / page.source).is_file():
                raise BuildError(CONFIG, 1, f"No Markdown file {page.source}.")
        for name, source in self.files.items():
            if not re.fullmatch(r"[a-z0-9-]+\.(css|svg)", name) or not (self.root / source).is_file():
                raise BuildError(CONFIG, 1, f"Files are .css or .svg files that exist: {name}")
        for label, href in self.links:
            if not href.startswith("https://") or not label:
                raise BuildError(CONFIG, 1, f"Links need a label and a https:// address: {href}")

    def resolve(self, source: str, destination: str, line: int) -> str:
        """The address of a link in `source`. Links to pages of the site stay
        on the site. Links to other files in the repository go to GitHub."""

        def fail(message: str):
            raise BuildError(source, line, message)

        if re.search(r"[\s\"'<>\\]", destination):
            fail(f"This link has a character that is not allowed: {destination}")
        if destination.startswith("https://"):
            return destination
        if destination.startswith("#"):
            self.anchor_checks.append((source, line, source, destination[1:]))
            return destination
        if re.match(r"[A-Za-z][A-Za-z0-9+.-]*:", destination) or destination.startswith("//"):
            fail("Only https:// links and links to files in the repository are allowed.")
        path, _, anchor = destination.partition("#")
        if not re.fullmatch(r"[A-Za-z0-9._/-]+", path):
            fail(f"Link to a file by its relative path, without ? or %: {destination}")
        target = posixpath.normpath(posixpath.join(posixpath.dirname(source), path))
        if target == ".." or target.startswith(("../", "/")):
            fail(f"This link leaves the repository: {destination}")
        fragment = f"#{anchor}" if anchor else ""
        if target in self.by_source:
            if anchor:
                self.anchor_checks.append((source, line, target, anchor))
            return self.by_source[target].url + fragment
        if (self.root / target).is_file():
            if anchor and target.endswith(".md"):
                self.anchor_checks.append((source, line, target, anchor))
            return f"{self.repository}/blob/main/{target}{fragment}"
        if (self.root / target).is_dir() and not anchor:
            return f"{self.repository}/tree/main/{target}"
        fail(f"No file or folder {target} in the repository.")

    def file_anchors(self, source: str) -> dict[str, int]:
        """The heading anchors of a Markdown file that is not a page of the site."""
        if source not in self._file_anchors:
            renderer = PageRenderer(self, source, check_links=False)
            fence = None
            text = (self.root / source).read_text(encoding="utf-8")
            for number, line in enumerate(text.split("\n"), 1):
                if fence:
                    if re.match(r"^ {0,3}%s{%d,} *$" % (re.escape(fence[0]), len(fence)), line):
                        fence = None
                elif match := FENCE.match(line):
                    fence = match[2]
                elif (heading := HEADING.match(line)) and heading[2].strip():
                    renderer.heading_id(render_inline(heading[2].strip(), renderer, number))
            self._file_anchors[source] = renderer.anchors
        return self._file_anchors[source]

    def render_page(self, page: Page, template: string.Template, commit: str | None) -> str:
        renderer = PageRenderer(self, page.source)
        text = (self.root / page.source).read_text(encoding="utf-8")
        if "\r" in text:
            raise BuildError(page.source, 1, "Use LF line endings.")
        lines = list(enumerate(text.split("\n"), 1))
        first_line = next((n for n, t in lines if t.strip()), 1)
        content = "\n".join(full for full, _, _ in parse_blocks(lines, renderer))
        if len(renderer.titles) != 1 or renderer.titles[0][0] != first_line:
            raise BuildError(page.source, first_line, "A page starts with one # heading, its title, and has no other.")
        self.page_anchors[page.source] = renderer.anchors
        heading = renderer.titles[0][1]
        title = heading if heading == self.name else f"{heading} · {self.name}"
        nav = []
        for other in self.pages:
            if other.nav:
                current = ' aria-current="page"' if other is page else ""
                nav.append(f'<li><a href="{esc(other.url)}"{current}>{esc_text(other.nav)}</a></li>')
        for label, href in self.links:
            nav.append(f'<li><a href="{esc(href)}">{esc_text(label)}</a></li>')
        built = ""
        if commit:
            built = (
                f' Built from commit <a href="{esc(self.repository)}/commit/{commit}">'
                f"<code>{commit[:7]}</code></a>."
            )
        return template.substitute(
            title=esc_text(title),
            name=esc_text(self.name),
            home_current=' aria-current="page"' if page.path == "index.html" else "",
            nav="\n".join(nav),
            content=content,
            built=built,
        )

    def build(self, commit: str | None = None) -> dict[str, bytes]:
        """Every file of the site, by its path in the output folder."""
        if commit is not None and not re.fullmatch(r"[0-9a-f]{40}", commit):
            raise BuildError("--commit", 1, "The commit must be 40 lower-case hex digits.")
        template = string.Template((self.root / "site/template.html").read_text(encoding="utf-8"))
        out = {}
        for page in self.pages:
            out[page.path] = self.render_page(page, template, commit).encode("utf-8")
        for source, line, target, anchor in self.anchor_checks:
            anchors = self.page_anchors.get(target)
            if anchors is None:
                anchors = self.file_anchors(target)
            if anchor not in anchors:
                raise BuildError(source, line, f"{target} has no heading for the link #{anchor}.")
        for name, source in self.files.items():
            out[name] = (self.root / source).read_bytes()
        return out


def write_site(files: dict[str, bytes], output: Path) -> None:
    """Writes the files into a new, empty folder, so no old file is left over."""
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise BuildError(str(output), 1, "The output folder must be new or empty.")
    for name in sorted(files):
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(files[name])


def annotation(error: BuildError) -> str:
    """The error as a GitHub Actions annotation, escaped so it cannot add commands."""

    def data(value: str) -> str:
        return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")

    def prop(value: str) -> str:
        return data(value).replace(":", "%3A").replace(",", "%2C")

    return f"::error file={prop(error.path)},line={error.line}::{data(error.message)}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the hub website from docs/ and site/.")
    parser.add_argument("output", type=Path, help="a new or empty folder for the site")
    parser.add_argument("--commit", help="the commit the site is built from, shown in the footer")
    args = parser.parse_args(argv)
    try:
        try:
            config = json.loads((ROOT / CONFIG).read_text(encoding="utf-8"))
            site = Site(ROOT, config)
        except (ValueError, KeyError, TypeError, AttributeError) as error:
            raise BuildError(CONFIG, 1, f"Not a valid site configuration: {error!r}") from error
        files = site.build(args.commit)
        write_site(files, args.output)
    except BuildError as error:
        print(annotation(error) if os.environ.get("GITHUB_ACTIONS") else f"error: {error}", file=sys.stderr)
        return 1
    for name in sorted(files):
        print(name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
