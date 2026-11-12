package app.shkriuss.buildlogic

import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * Fails the build when the tests that should run on the emulator and the
 * tests that do run there are not the same (ADR 0028).
 *
 * The project's test runner runs one class: the JUnit suite
 * `InstrumentedTests` in the module's package. A test class that the
 * suite does not list is compiled, and never runs. Nothing would say so.
 * This check compares the two lists:
 *
 * - every class with a `@Test` function in the module's `src/androidTest/`
 *   and `src/sharedTest/` folders,
 * - every class the suite lists in `@Suite.SuiteClasses`.
 *
 * It fails if a class is in one list and not in the other, if a module
 * has such tests and no suite, or if it cannot tell which class a test
 * file holds.
 *
 * It reads the source text, not compiled classes, so it runs without
 * building a test APK. For that it asks for a simple shape: a file with
 * `@Test` holds exactly one class that starts at the left edge, and the
 * suite names each class as `Name::class`. Comments and text in quotes
 * are left out before it looks, so a `@Test` in a comment counts for
 * nothing.
 */
abstract class CheckInstrumentedTestSuiteTask : DefaultTask() {
    /** The module's `src/androidTest/` and `src/sharedTest/` folders. One of them may not exist. */
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val sourceFolders: ConfigurableFileCollection

    /** The module's package, where the runner looks for the suite. */
    @get:Input
    abstract val modulePackage: Property<String>

    /** Written when the check passes, so Gradle can skip the task next time. */
    @get:OutputFile
    abstract val report: RegularFileProperty

    @TaskAction
    fun check() {
        val files = sourceFolders.asFileTree.files.sortedBy { it.path }
        val sources = files.filter { it.extension == "kt" }.map { SourceFile(it.name, it.readText()) }
        val notKotlin = files.filter { it.extension == "java" }.map { "${it.name} is not Kotlin" }
        val problems = notKotlin + suiteProblems(sources, modulePackage.get())
        if (problems.isNotEmpty()) {
            throw GradleException(failureMessage(problems))
        }
        report.get().asFile.writeText(
            "Read ${sources.size} files. The suite ${modulePackage.get()}.$SUITE lists every class with @Test, and nothing else.\n",
        )
    }

    private fun failureMessage(problems: List<String>): String = buildString {
        appendLine("The instrumented tests and the suite ${modulePackage.get()}.$SUITE do not match:")
        problems.forEach { appendLine("- $it") }
        appendLine("The emulator runs only the classes the suite lists. A test class that is not")
        appendLine("listed would never run, and nothing would say so (ADR 0028).")
        appendLine("Add the class to @Suite.SuiteClasses in $SUITE.kt, or take it out there.")
        append("Do not change this check. See docs/development/build.md, \"Instrumented test suite check\".")
    }

    /** One Kotlin file: its name, for messages, and its text. */
    internal class SourceFile(val name: String, val text: String)

    internal companion object {
        /** The class the runner in `core/testing` runs. */
        const val SUITE = "InstrumentedTests"

        private val PACKAGE = Regex("""^package\s+([\w.]+)""", RegexOption.MULTILINE)
        private val IMPORT = Regex("""^import\s+([\w.]+)\s*$""", RegexOption.MULTILINE)
        private val TEST = Regex("""@(?:org\.junit\.)?Test\b""")

        /** A class that starts at the left edge of the file. A class inside another class is indented. */
        private val TOP_LEVEL_CLASS = Regex(
            """^(?:(?:public|internal|private|open|abstract|final|sealed|data)\s+)*class\s+([A-Za-z_]\w*)""",
            RegexOption.MULTILINE,
        )
        private val SUITE_CLASSES = Regex("""@Suite\.SuiteClasses\s*\(([^)]*)\)""")
        private val LISTED_CLASS = Regex("""([A-Za-z_][\w.]*)\s*::\s*class""")

        /** What is wrong between the test classes in [sources] and the suite, empty if nothing. */
        fun suiteProblems(sources: List<SourceFile>, modulePackage: String): List<String> {
            val problems = mutableListOf<String>()
            val testClasses = sortedSetOf<String>()
            var listed: Set<String>? = null
            for (source in sources) {
                val code = withoutCommentsAndQuotes(source.text)
                val filePackage = PACKAGE.find(code)?.groupValues?.get(1).orEmpty()
                val classes = TOP_LEVEL_CLASS.findAll(code).map { it.groupValues[1] }.toList()
                if (SUITE in classes && filePackage == modulePackage) {
                    listed = listedClasses(code, filePackage)
                }
                if (!TEST.containsMatchIn(code)) continue
                if (classes.size == 1) {
                    testClasses += "$filePackage.${classes.single()}"
                } else {
                    problems += "${source.name} has @Test and ${classes.size} classes at the left edge. " +
                        "The check needs exactly one, to know which class the tests are in"
                }
            }
            val inSuite = listed
            if (inSuite == null) {
                if (testClasses.isNotEmpty() || problems.isNotEmpty()) {
                    problems += "There is no class $modulePackage.$SUITE, so none of these tests would run"
                }
                return problems
            }
            (testClasses - inSuite).forEach { problems += "$it has @Test and is not in the suite. It would never run" }
            (inSuite - testClasses).sorted().forEach {
                problems += "The suite lists $it, which is not a class with @Test in src/androidTest or src/sharedTest"
            }
            return problems
        }

        /** The classes `@Suite.SuiteClasses` names, with their packages. */
        private fun listedClasses(code: String, suitePackage: String): Set<String> {
            val imports = IMPORT.findAll(code).map { it.groupValues[1] }.associateBy { it.substringAfterLast('.') }
            val list = SUITE_CLASSES.find(code)?.groupValues?.get(1).orEmpty()
            return LISTED_CLASS.findAll(list).map { it.groupValues[1] }.map { name ->
                when {
                    '.' in name -> name
                    else -> imports[name] ?: "$suitePackage.$name"
                }
            }.toSet()
        }

        /**
         * The text of a Kotlin file with every comment and everything in
         * quotes replaced by spaces. Line breaks stay, so a class still
         * starts at the left edge of its line.
         */
        fun withoutCommentsAndQuotes(text: String): String {
            val out = StringBuilder(text.length)
            var index = 0
            while (index < text.length) {
                val end = when {
                    text.startsWith("//", index) -> text.indexOf('\n', index).let { if (it < 0) text.length else it }
                    text.startsWith("/*", index) -> endOfBlockComment(text, index)
                    text.startsWith("\"\"\"", index) -> endOfRawString(text, index)
                    text[index] == '"' || text[index] == '\'' -> endOfQuoted(text, index)
                    else -> index
                }
                if (end == index) {
                    out.append(text[index])
                    index++
                } else {
                    for (position in index until end) out.append(if (text[position] == '\n') '\n' else ' ')
                    index = end
                }
            }
            return out.toString()
        }

        /** Kotlin's block comments can hold block comments. */
        private fun endOfBlockComment(text: String, start: Int): Int {
            var depth = 0
            var index = start
            while (index < text.length) {
                when {
                    text.startsWith("/*", index) -> {
                        depth++
                        index += 2
                    }
                    text.startsWith("*/", index) -> {
                        depth--
                        index += 2
                        if (depth == 0) return index
                    }
                    else -> index++
                }
            }
            return text.length
        }

        private fun endOfRawString(text: String, start: Int): Int {
            val close = text.indexOf("\"\"\"", start + 3)
            if (close < 0) return text.length
            var end = close + 3
            // A raw string may end with more than three quotes.
            while (end < text.length && text[end] == '"') end++
            return end
        }

        private fun endOfQuoted(text: String, start: Int): Int {
            val quote = text[start]
            var index = start + 1
            while (index < text.length && text[index] != quote && text[index] != '\n') {
                index += if (text[index] == '\\') 2 else 1
            }
            return minOf(index + 1, text.length)
        }
    }
}
