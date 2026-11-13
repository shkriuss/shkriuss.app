package app.shkriuss.buildlogic

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Shows that the logging check ([CheckNoLoggingTask]) fails on main code
 * that logs or prints, in every form, and passes on main code that does not
 * and on test code that does.
 */
class NoLoggingCheckTest {
    @get:Rule
    val temporary = TemporaryFolder()

    /** The ten forms of `theModuleNeverLogsOrPrints`, the test in core/crypto that this check replaced. */
    private val formsOfTheReplacedTest = listOf(
        "android.util.Log", "Log.", "println", "print(", "printStackTrace",
        "System.out", "System.err", "java.util.logging", "Logger", "Timber",
    )

    /** One line of main code for each form. */
    private val samples = mapOf(
        "android.util.Log" to "import android.util.Log",
        "Log." to "    Log.d(\"tag\", note.text)",
        "println" to "    println(note)",
        "print(" to "    print(amount)",
        "printStackTrace" to "    failure.printStackTrace()",
        "System.out" to "    System.out.write(bytes)",
        "System.err" to "    System.err.write(bytes)",
        "java.util.logging" to "import java.util.logging.Level",
        "Logger" to "    val log = Logger.getLogger(\"notes\")",
        "Timber" to "    Timber.i(title)",
        "Log::" to "    names.forEach(Log::wtf)",
        "::print" to "    names.forEach(::print)",
        "dumpStack" to "    Thread.dumpStack()",
    )

    private val clean = """
        package app.shkriuss.feature.notes

        /** Keeps a note. Shows nothing, writes nothing anywhere but the database. */
        class NoteKeeper(private val dao: NoteDao) {
            fun keep(note: Note) = dao.save(note)
        }
    """.trimIndent()

    private fun module(vararg files: Pair<String, String>): File {
        val src = temporary.newFolder("module-${files.size}-${files.hashCode()}", "src")
        files.forEach { (path, text) -> src.resolve(path).apply { parentFile.mkdirs() }.writeText(text) }
        return src
    }

    private fun problemsIn(src: File): List<String> = CheckNoLoggingTask.mainSourceFiles(src).flatMap { file ->
        CheckNoLoggingTask.loggingProblems(file.relativeTo(src).invariantSeparatorsPath, file.readText())
    }

    @Test
    fun theCheckForbidsEveryFormOfTheTestItReplaced() {
        assertTrue(CheckNoLoggingTask.FORBIDDEN.containsAll(formsOfTheReplacedTest))
        assertEquals(CheckNoLoggingTask.FORBIDDEN.toSet(), samples.keys)
    }

    @Test
    fun eachFormFailsInMainCode() {
        samples.forEach { (form, line) ->
            val src = module("main/kotlin/app/shkriuss/Sample.kt" to "package app.shkriuss\n\nfun sample() {\n$line\n}\n")
            val problems = problemsIn(src)
            assertTrue("$form must fail, found $problems", problems.contains("main/kotlin/app/shkriuss/Sample.kt:4: $form"))
        }
    }

    @Test
    fun aFormInACommentOrAStringFailsToo() {
        val src = module(
            "main/kotlin/A.kt" to "// Never use Timber here.\nval text = \"System.out\"\n",
        )
        assertEquals(listOf("main/kotlin/A.kt:1: Timber", "main/kotlin/A.kt:2: System.out"), problemsIn(src))
    }

    @Test
    fun cleanMainCodePasses() {
        val src = module("main/kotlin/app/shkriuss/feature/notes/NoteKeeper.kt" to clean)
        assertEquals(1, CheckNoLoggingTask.mainSourceFiles(src).size)
        assertEquals(emptyList<String>(), problemsIn(src))
    }

    @Test
    fun everyFolderThatIsNotTestCodeIsMainCode() {
        val logging = "fun log() = println(\"x\")\n"
        val src = module(
            "main/kotlin/A.kt" to logging,
            "main/java/B.java" to "class B { void b() { System.out.println(); } }\n",
            "debug/kotlin/C.kt" to logging,
            "release/kotlin/D.kt" to logging,
            "preview/kotlin/E.kt" to logging,
            "somethingNew/kotlin/F.kt" to logging,
        )
        assertEquals(
            listOf("debug/kotlin/C.kt", "main/java/B.java", "main/kotlin/A.kt", "preview/kotlin/E.kt", "release/kotlin/D.kt", "somethingNew/kotlin/F.kt"),
            problemsIn(src).map { it.substringBefore(':') }.distinct(),
        )
    }

    @Test
    fun testCodeIsNotChecked() {
        val logging = "fun log() { println(\"x\"); android.util.Log.i(\"t\", \"m\") }\n"
        val src = module(
            "main/kotlin/A.kt" to clean,
            "test/kotlin/T.kt" to logging,
            "testDebug/kotlin/T.kt" to logging,
            "testFixtures/kotlin/F.kt" to logging,
            "androidTest/kotlin/I.kt" to logging,
            "androidTestDebug/kotlin/I.kt" to logging,
            "sharedTest/kotlin/S.kt" to logging,
        )
        assertEquals(listOf("main/kotlin/A.kt"), CheckNoLoggingTask.mainSourceFiles(src).map { it.relativeTo(src).invariantSeparatorsPath })
        assertEquals(emptyList<String>(), problemsIn(src))
    }

    @Test
    fun otherFilesAreNotRead() {
        val src = module(
            "main/kotlin/A.kt" to clean,
            "main/res/values/strings.xml" to "<resources><string name=\"a\">Log.</string></resources>\n",
            "main/AndroidManifest.xml" to "<manifest/>\n",
        )
        assertEquals(emptyList<String>(), problemsIn(src))
    }

    @Test
    fun aModuleWithoutMainCodeHasNothingToRead() {
        val src = module("test/kotlin/T.kt" to clean, "main/res/values/strings.xml" to "<resources/>\n")
        assertEquals(emptyList<File>(), CheckNoLoggingTask.mainSourceFiles(src))
    }

    @Test
    fun testFoldersAreTheOnlyOnesLeftOut() {
        listOf("test", "testDebug", "testFixtures", "testFixturesRelease", "androidTest", "androidTestDebug", "sharedTest")
            .forEach { assertTrue(it, CheckNoLoggingTask.isTestFolder(it)) }
        listOf("main", "debug", "release", "preview", "screenshotTest", "shared")
            .forEach { assertTrue(it, !CheckNoLoggingTask.isTestFolder(it)) }
    }
}
