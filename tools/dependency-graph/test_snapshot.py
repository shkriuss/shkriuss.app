"""Tests for snapshot.py, which turns Gradle's dependency reports into a
snapshot for GitHub's dependency graph.

Run them from the repository root:

    python3 -B -m unittest discover -s tools/dependency-graph -t tools/dependency-graph
"""

import contextlib
import datetime
import io
import json
import tempfile
import unittest
from pathlib import Path

import snapshot

# The form of `./gradlew :app:water:dependencies --configuration
# releaseRuntimeClasspath`, shortened.
REPORT = """
> Task :app:water:dependencies

------------------------------------------------------------
Project ':app:water'
------------------------------------------------------------

releaseRuntimeClasspath - Resolved configuration for runtime for variant: release
+--- project :core:design
|    +--- androidx.compose:compose-bom:2026.09.00
|    |    +--- androidx.compose.material3:material3:1.4.0 (c)
|    |    \\--- androidx.compose.ui:ui:1.12.1 (c)
|    +--- androidx.compose.material3:material3 -> 1.4.0
|    |    +--- androidx.activity:activity-compose:1.8.2 -> 1.13.0
|    |    |    \\--- org.jetbrains.kotlin:kotlin-stdlib:2.0.21 -> 2.4.21
|    |    \\--- androidx.compose.ui:ui -> 1.12.1
|    |         \\--- org.jetbrains.kotlin:kotlin-stdlib:2.0.21 -> 2.4.21
|    \\--- org.jetbrains.kotlin:kotlin-stdlib:{strictly 2.4.21} -> 2.4.21 (*)
+--- project :feature:water
|    +--- project :core:design (*)
|    \\--- com.google.crypto.tink:tink-android:1.24.0
|         \\--- com.google.code.gson:gson:2.13.2
|              \\--- com.google.errorprone:error_prone_annotations:2.41.0
+--- androidx.activity:activity-compose:1.13.0 (*)
\\--- androidx.lifecycle:lifecycle-runtime:2.11.0 (n)

(c) - A dependency constraint, not a dependency. The dependency affected by the constraint occurs elsewhere in the tree.
(*) - Indicates repeated occurrences of a transitive dependency subtree.

BUILD SUCCESSFUL in 3s
"""

BOM = "pkg:maven/androidx.compose/compose-bom@2026.09.00"
MATERIAL3 = "pkg:maven/androidx.compose.material3/material3@1.4.0"
ACTIVITY = "pkg:maven/androidx.activity/activity-compose@1.13.0"
STDLIB = "pkg:maven/org.jetbrains.kotlin/kotlin-stdlib@2.4.21"
UI = "pkg:maven/androidx.compose.ui/ui@1.12.1"
TINK = "pkg:maven/com.google.crypto.tink/tink-android@1.24.0"
GSON = "pkg:maven/com.google.code.gson/gson@2.13.2"
ERROR_PRONE = "pkg:maven/com.google.errorprone/error_prone_annotations@2.41.0"

COMMIT = "0123456789abcdef0123456789abcdef01234567"


def report_with(*entries):
    """A report whose tree holds only these lines."""
    return "releaseRuntimeClasspath - Runtime classpath\n" + "\n".join(entries) + "\n\n"


class ParseTest(unittest.TestCase):
    def test_every_library_once_with_its_resolved_version(self):
        libraries = snapshot.parse(REPORT)
        self.assertEqual(
            sorted(libraries),
            sorted([BOM, MATERIAL3, ACTIVITY, STDLIB, UI, TINK, GSON, ERROR_PRONE]),
        )

    def test_constraints_and_unresolved_entries_are_not_libraries(self):
        libraries = snapshot.parse(REPORT)
        self.assertNotIn("pkg:maven/androidx.lifecycle/lifecycle-runtime@2.11.0", libraries)
        self.assertEqual(libraries[BOM][1], set())

    def test_direct_when_the_app_or_a_project_asks_for_it(self):
        libraries = snapshot.parse(REPORT)
        direct = {url for url, (is_direct, _) in libraries.items() if is_direct}
        # The app asks for activity-compose itself, so it is direct, also
        # though material3 asks for it too. kotlin-stdlib is asked for by
        # core/design.
        self.assertEqual(direct, {BOM, MATERIAL3, ACTIVITY, STDLIB, TINK})

    def test_what_each_library_needs(self):
        libraries = snapshot.parse(REPORT)
        self.assertEqual(libraries[MATERIAL3][1], {ACTIVITY, UI})
        self.assertEqual(libraries[ACTIVITY][1], {STDLIB})
        self.assertEqual(libraries[UI][1], {STDLIB})
        self.assertEqual(libraries[TINK][1], {GSON})
        self.assertEqual(libraries[GSON][1], {ERROR_PRONE})
        self.assertEqual(libraries[ERROR_PRONE][1], set())

    def test_a_failed_entry_fails(self):
        with self.assertRaisesRegex(snapshot.ReportError, "could not resolve"):
            snapshot.parse(report_with("+--- com.example:missing:1.0 FAILED"))

    def test_a_report_without_the_configuration_fails(self):
        with self.assertRaisesRegex(snapshot.ReportError, "releaseRuntimeClasspath"):
            snapshot.parse("debugRuntimeClasspath - Runtime classpath\n+--- a.b:c:1.0\n")

    def test_the_configuration_twice_fails(self):
        with self.assertRaises(snapshot.ReportError):
            snapshot.parse(report_with("+--- a.b:c:1.0") + report_with("+--- a.b:c:1.0"))

    def test_an_unexpected_line_fails(self):
        with self.assertRaisesRegex(snapshot.ReportError, "Unexpected line"):
            snapshot.parse(report_with("+--- a.b:c:1.0", "something else"))

    def test_a_skipped_level_fails(self):
        with self.assertRaisesRegex(snapshot.ReportError, "indentation"):
            snapshot.parse(report_with("+--- a.b:c:1.0", "|    |    \\--- a.b:d:1.0"))

    def test_an_entry_without_a_version_fails(self):
        with self.assertRaisesRegex(snapshot.ReportError, "No version"):
            snapshot.parse(report_with("+--- a.b:c"))

    def test_an_entry_with_unexpected_characters_fails(self):
        with self.assertRaises(snapshot.ReportError):
            snapshot.parse(report_with("+--- a.b:c d:1.0"))

    def test_a_tree_of_projects_only_fails(self):
        with self.assertRaisesRegex(snapshot.ReportError, "No libraries"):
            snapshot.parse(report_with("\\--- project :core:design"))


class SnapshotTest(unittest.TestCase):
    NOW = datetime.datetime(2026, 11, 15, 12, 0, 0, tzinfo=datetime.timezone.utc)

    def test_the_form_of_the_submission_api(self):
        result = snapshot.snapshot(COMMIT, "refs/heads/main", "42", [("water", REPORT)], self.NOW)
        self.assertEqual(result["version"], 0)
        self.assertEqual(result["sha"], COMMIT)
        self.assertEqual(result["ref"], "refs/heads/main")
        self.assertEqual(result["job"], {"correlator": snapshot.CORRELATOR, "id": "42"})
        self.assertEqual(result["scanned"], "2026-11-15T12:00:00Z")
        name = "android/app/water (releaseRuntimeClasspath)"
        self.assertEqual(list(result["manifests"]), [name])
        water = result["manifests"][name]
        self.assertEqual(water["file"], {"source_location": "android/app/water/build.gradle.kts"})
        self.assertEqual(
            water["resolved"][MATERIAL3],
            {
                "package_url": MATERIAL3,
                "relationship": "direct",
                "scope": "runtime",
                "dependencies": [ACTIVITY, UI],
            },
        )
        self.assertEqual(water["resolved"][GSON]["relationship"], "indirect")

    def test_only_main(self):
        with self.assertRaisesRegex(snapshot.ReportError, "refs/heads/main"):
            snapshot.snapshot(COMMIT, "refs/heads/other", "42", [("water", REPORT)], self.NOW)

    def test_a_bad_commit_run_or_app_fails(self):
        for commit, run_id, app in [
            ("abc", "42", "water"),
            (COMMIT, "0", "water"),
            (COMMIT, "42", "Water"),
            (COMMIT, "42", "../water"),
        ]:
            with self.subTest(commit=commit, run_id=run_id, app=app):
                with self.assertRaises(snapshot.ReportError):
                    snapshot.snapshot(commit, "refs/heads/main", run_id, [(app, REPORT)], self.NOW)


class MainTest(unittest.TestCase):
    def run_main(self, folder, *extra):
        report = Path(folder) / "water.txt"
        report.write_text(REPORT, encoding="utf-8")
        out = Path(folder) / "snapshot.json"
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = snapshot.main(
                ["--sha", COMMIT, "--ref", "refs/heads/main", "--run-id", "7", "--out", str(out)]
                + list(extra)
                + [f"water={report}"]
            )
        return code, out, output.getvalue()

    def test_writes_the_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            code, out, printed = self.run_main(folder)
            self.assertEqual(code, 0)
            written = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(written["sha"], COMMIT)
            self.assertIn("android/app/water (releaseRuntimeClasspath): 8 libraries", printed)

    def test_an_error_is_a_workflow_error_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as folder:
            missing = Path(folder) / "missing.txt"
            out = Path(folder) / "snapshot.json"
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = snapshot.main(
                    ["--sha", COMMIT, "--ref", "refs/heads/main", "--run-id", "7",
                     "--out", str(out), f"water={missing}"]
                )
            self.assertEqual(code, 1)
            self.assertTrue(output.getvalue().startswith("::error::"))
            self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
