package app.shkriuss.buildlogic

import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.Directory
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.ListProperty
import org.gradle.api.tasks.IgnoreEmptyDirectories
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * Fails the build when the database schemas the code produces are not the
 * committed ones in the module's `schemas/` folder.
 *
 * Room's compiler compares each database with the committed schema file of
 * its current version. It writes a schema file only when that file is
 * missing, or describes a different schema (formatting aside). Its Gradle
 * plugin would then copy the file over the committed one, so a schema
 * change without a new version, or a file nobody committed, would pass
 * unnoticed. [AndroidRoomConventionPlugin] turns that copy off and runs
 * this check in `check` instead: every file Room wrote must already be
 * committed exactly as written. `recordRoomSchemas` writes the files.
 */
abstract class CheckRoomSchemasTask : DefaultTask() {
    /** The folders Room's compiler wrote schema files to, one per compile task. */
    @get:InputFiles
    @get:IgnoreEmptyDirectories
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val generatedDirectories: ListProperty<Directory>

    /** The module's committed `schemas/` folder. It may not exist yet. */
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val committedDirectory: DirectoryProperty

    /** Written when the check passes, so Gradle can skip the task next time. */
    @get:OutputFile
    abstract val report: RegularFileProperty

    @TaskAction
    fun check() {
        val committedRoot = committedDirectory.get().asFile
        val problems = sortedSetOf<String>()
        var fileCount = 0
        generatedDirectories.get().map { it.asFile }.filter { it.isDirectory }.forEach { root ->
            root.walkTopDown().filter { it.isFile }.forEach { generated ->
                fileCount++
                val path = generated.relativeTo(root).invariantSeparatorsPath
                val committed = committedRoot.resolve(path)
                when {
                    !committed.isFile -> problems += "$path is not committed"
                    !committed.readBytes().contentEquals(generated.readBytes()) ->
                        problems += "$path differs from the committed file"
                }
            }
        }
        if (problems.isNotEmpty()) {
            throw GradleException(failureMessage(problems))
        }
        report.get().asFile.writeText(
            "Room wrote $fileCount schema files, each committed as written. " +
                "It writes none for a database whose committed schema matches.\n",
        )
    }

    private fun failureMessage(problems: Set<String>): String = buildString {
        appendLine("The database schemas the code produces are not the committed ones in schemas/:")
        problems.forEach { appendLine("- $it") }
        appendLine("A schema change bumps the database version, adds a migration and its test,")
        appendLine("and commits the new schema file (CLAUDE.md, \"Changing formats\").")
        appendLine("Run ./gradlew recordRoomSchemas to write the files, then commit them.")
        append("Never change the schema file of a version that was released.")
    }
}
