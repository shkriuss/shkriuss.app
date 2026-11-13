package app.shkriuss.buildlogic

import java.io.File
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * Fails the build when the main code of a module could write to a log or to
 * the standard output (hard rule 10 in CLAUDE.md: user content must never
 * reach a log).
 *
 * It reads the text of every `.kt` and `.java` file in every folder under
 * the module's `src/` that is not test code: `main`, `debug`, `release`,
 * `preview`, `testFixtures`, and any folder added later. Test code is a
 * folder whose name starts with `test` but not `testFixtures`, or starts
 * with `androidTest`, or is `sharedTest`. Tests never ship in an app, and
 * they may print. Test fixtures count as main code: an app that wrongly
 * depends on them would ship them (owner's decision on pull request 34).
 *
 * It searches the raw text, comments and strings included, for each of
 * [FORBIDDEN]. That is how the test it replaced, `theModuleNeverLogsOrPrints`
 * in `core/crypto`, read the code, so the rule is never weaker than that
 * test. It fails if it finds no main code at all, so it never passes by
 * reading nothing.
 *
 * `AndroidCommon.kt` registers it in every Android module except
 * `core/testing`, which holds test helpers only and may never be used
 * outside tests (docs/development/build.md, "Logging check").
 */
abstract class CheckNoLoggingTask : DefaultTask() {
    /** The module's path, such as `:core:design`, for the failure message. */
    @get:Input
    abstract val modulePath: Property<String>

    /** The module's `src/` folder. The task picks the folders of main code itself. */
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sourceRoot: DirectoryProperty

    /** Written when the check passes, so Gradle can skip the task next time. */
    @get:OutputFile
    abstract val report: RegularFileProperty

    @TaskAction
    fun check() {
        val root = sourceRoot.get().asFile
        val files = mainSourceFiles(root)
        if (files.isEmpty()) {
            throw GradleException(
                "The logging check found no main code in ${modulePath.get()} (no .kt or .java file under src/ " +
                    "outside the test folders), so it cannot check anything. If the module really has no code, " +
                    "stop and ask the owner. See docs/development/build.md, \"Logging check\".",
            )
        }
        val problems = files.flatMap { file -> loggingProblems(file.relativeTo(root).invariantSeparatorsPath, file.readText()) }
        if (problems.isNotEmpty()) {
            throw GradleException(failureMessage(problems))
        }
        report.get().asFile.writeText(
            "Read ${files.size} files of main code in ${modulePath.get()}. None holds any of: " +
                FORBIDDEN.joinToString(", ") + ".\n",
        )
    }

    private fun failureMessage(problems: List<String>): String = buildString {
        appendLine("Main code of ${modulePath.get()} could write to a log or the standard output (hard rule 10):")
        problems.forEach { appendLine("- src/$it") }
        appendLine("User content must never reach a log, so main code never logs or prints. Remove the call.")
        appendLine("A comment or a text in quotes with one of these forms fails too, as in the test this")
        appendLine("check replaced. Write it another way. Tests may print: they are not checked.")
        append("If main code really needs a log, stop and ask the owner. Do not change this check. ")
        append("See docs/development/build.md, \"Logging check\".")
    }

    internal companion object {
        /**
         * The forms main code must never contain. The first ten are the ones
         * `theModuleNeverLogsOrPrints` forbade. The last three close gaps:
         * a function reference to a log or print function, which names
         * neither `Log.` nor `print(`, and `Thread.dumpStack()`, which prints
         * to the standard error.
         */
        val FORBIDDEN = listOf(
            "android.util.Log",
            "Log.",
            "println",
            "print(",
            "printStackTrace",
            "System.out",
            "System.err",
            "java.util.logging",
            "Logger",
            "Timber",
            "Log::",
            "::print",
            "dumpStack",
        )

        /** Source folders whose name starts with one of these hold test code, unless it starts with [FIXTURES]. */
        private val TEST_FOLDER_STARTS = listOf("test", "androidTest")

        /** Test fixtures, whose folders start with `test` but count as main code. */
        private const val FIXTURES = "testFixtures"

        /** Source folders with one of these names hold test code. */
        private val TEST_FOLDERS = setOf("sharedTest")

        private val SOURCE_EXTENSIONS = setOf("kt", "java")

        /** True for a folder directly under `src/` that holds test code. Test fixtures are not test code here. */
        fun isTestFolder(name: String): Boolean =
            name in TEST_FOLDERS || (!name.startsWith(FIXTURES) && TEST_FOLDER_STARTS.any { name.startsWith(it) })

        /** Every `.kt` and `.java` file under [sourceRoot] that is not in a test folder, sorted by path. */
        fun mainSourceFiles(sourceRoot: File): List<File> =
            (sourceRoot.listFiles() ?: emptyArray())
                .filter { it.isDirectory && !isTestFolder(it.name) }
                .flatMap { folder -> folder.walkTopDown().filter { it.isFile && it.extension in SOURCE_EXTENSIONS }.toList() }
                .sortedBy { it.invariantSeparatorsPath }

        /** Each line of [text] that holds a form of [FORBIDDEN], as `path:line: form`. */
        fun loggingProblems(path: String, text: String): List<String> =
            text.lines().flatMapIndexed { index, line ->
                FORBIDDEN.filter { it in line }.map { form -> "$path:${index + 1}: $form" }
            }
    }
}
