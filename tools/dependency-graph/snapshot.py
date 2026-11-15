"""Turns Gradle's dependency report of each app into one snapshot for
GitHub's dependency graph, so that Dependabot alerts can name a library
with a known vulnerability.

Only the job "List" of .github/workflows/dependency-graph.yml runs it,
with a read-only token. It reads the report files and writes one JSON
file. It runs no Gradle and sends nothing. Why it exists:
docs/development/ci.md, "Dependency graph".

Usage, from the repository root:
  python3 -B tools/dependency-graph/snapshot.py --sha SHA --ref REF \
      --run-id ID --out FILE APP=REPORT [APP=REPORT ...]

Each REPORT is what this prints, run from android/:
  ./gradlew :app:APP:dependencies --configuration releaseRuntimeClasspath
"""

import argparse
import datetime
import json
import re
import sys

CONFIGURATION = "releaseRuntimeClasspath"
# The same in every run, so that each snapshot replaces the one before.
CORRELATOR = "dependency-graph release-runtime-classpath"
DETECTOR = {
    "name": "tools/dependency-graph/snapshot.py",
    "version": "1",
    "url": "https://github.com/shkriuss/shkriuss.app/blob/main/tools/dependency-graph/snapshot.py",
}
APP = re.compile(r"[a-z][a-z0-9]*")
COMMIT = re.compile(r"[0-9a-f]{40}")
RUN_ID = re.compile(r"[1-9][0-9]*")
# One entry of Gradle's tree: steps of five characters, then "+--- " or "\--- ".
ENTRY = re.compile(r"((?:[| ] {4})*)[+\\]--- (.+)")
NAME = re.compile(r"[A-Za-z0-9_.-]+")
VERSION = re.compile(r"[A-Za-z0-9_.+-]+")


class ReportError(Exception):
    """The report is not what this script expects. The run must fail."""


def package_url(entry):
    """The package URL of one library entry, such as "a.b:c:1.0 -> 1.1"."""
    if " FAILED" in entry:
        raise ReportError(f"Gradle could not resolve: {entry}")
    requested, arrow, resolved = entry.partition(" -> ")
    parts = requested.split(":")
    if len(parts) not in (2, 3):
        raise ReportError(f"Unexpected entry: {entry}")
    group, name = parts[0], parts[1]
    if arrow:
        version = resolved
    elif len(parts) == 3:
        version = parts[2]
    else:
        raise ReportError(f"No version in: {entry}")
    if not (NAME.fullmatch(group) and NAME.fullmatch(name) and VERSION.fullmatch(version)):
        raise ReportError(f"Unexpected entry: {entry}")
    return f"pkg:maven/{group}/{name}@{version}"


def parse(report):
    """Reads the configuration's tree from one report.

    Returns {package URL: (direct, set of the package URLs it depends on)}.
    A library is direct when the app or one of the build's projects asks
    for it.
    """
    lines = report.splitlines()
    starts = [i for i, line in enumerate(lines) if line.startswith(CONFIGURATION + " - ")]
    if len(starts) != 1:
        raise ReportError(f"Expected the configuration {CONFIGURATION} once in the report.")
    libraries = {}
    parents = []  # (depth, package URL, or None for a project of the build)
    for line in lines[starts[0] + 1:]:
        if not line.strip():
            break
        match = ENTRY.fullmatch(line)
        if not match:
            raise ReportError(f"Unexpected line: {line}")
        depth = len(match[1]) // 5
        entry = match[2]
        # A constraint (c) and an entry that Gradle did not resolve (n) are
        # not dependencies. Neither has entries under it.
        if entry.endswith((" (c)", " (n)")):
            continue
        entry = entry.removesuffix(" (*)")
        while parents and parents[-1][0] >= depth:
            parents.pop()
        if len(parents) != depth:
            raise ReportError(f"Unexpected indentation: {line}")
        parent = parents[-1][1] if parents else None
        if entry.startswith("project "):
            url = None
        else:
            url = package_url(entry)
            direct, needs = libraries.get(url, (False, set()))
            libraries[url] = (direct or parent is None, needs)
            if parent is not None:
                libraries[parent][1].add(url)
        parents.append((depth, url))
    if not libraries:
        raise ReportError("No libraries in the report.")
    return libraries


def manifest(app, report):
    """One app's part of the snapshot: every library and what it needs."""
    resolved = {}
    for url, (direct, needs) in sorted(parse(report).items()):
        resolved[url] = {
            "package_url": url,
            "relationship": "direct" if direct else "indirect",
            "scope": "runtime",
            "dependencies": sorted(needs),
        }
    name = f"android/app/{app} ({CONFIGURATION})"
    return name, {
        "name": name,
        "file": {"source_location": f"android/app/{app}/build.gradle.kts"},
        "resolved": resolved,
    }


def snapshot(commit, ref, run_id, reports, now):
    """The whole snapshot, in the form of GitHub's dependency submission API."""
    if not COMMIT.fullmatch(commit):
        raise ReportError("Unexpected commit.")
    if ref != "refs/heads/main":
        raise ReportError("A snapshot is only made for refs/heads/main.")
    if not RUN_ID.fullmatch(run_id):
        raise ReportError("Unexpected run number.")
    manifests = {}
    for app, report in reports:
        if not APP.fullmatch(app):
            raise ReportError(f"Unexpected app name: {app}")
        name, value = manifest(app, report)
        manifests[name] = value
    return {
        "version": 0,
        "sha": commit,
        "ref": ref,
        "job": {"correlator": CORRELATOR, "id": run_id},
        "detector": DETECTOR,
        "scanned": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "manifests": manifests,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Writes the dependency snapshot of the apps.")
    parser.add_argument("--sha", required=True)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("reports", nargs="+", metavar="APP=REPORT")
    args = parser.parse_args(argv)
    try:
        reports = []
        for item in args.reports:
            app, separator, path = item.partition("=")
            if not separator:
                raise ReportError(f"Expected APP=REPORT, not {item}")
            with open(path, encoding="utf-8") as file:
                reports.append((app, file.read()))
        now = datetime.datetime.now(datetime.timezone.utc)
        result = snapshot(args.sha, args.ref, args.run_id, reports, now)
    except (ReportError, OSError) as error:
        print(f"::error::{error}")
        return 1
    with open(args.out, "w", encoding="utf-8") as file:
        json.dump(result, file, indent=2, sort_keys=True)
        file.write("\n")
    for name, value in result["manifests"].items():
        print(f"{name}: {len(value['resolved'])} libraries")
    return 0


if __name__ == "__main__":
    sys.exit(main())
