package app.shkriuss.buildlogic

import androidx.room3.gradle.RoomExtension
import androidx.room3.gradle.RoomSchemaCopyTask
import com.android.build.api.variant.HostTestBuilder
import com.android.build.api.variant.LibraryAndroidComponentsExtension
import com.google.devtools.ksp.gradle.KspAATask
import com.google.devtools.ksp.gradle.KspExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.file.DuplicatesStrategy
import org.gradle.api.tasks.Copy
import org.gradle.api.tasks.compile.JavaCompile
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies
import org.gradle.kotlin.dsl.named
import org.gradle.kotlin.dsl.register
import org.gradle.kotlin.dsl.withType
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile

/**
 * Plugin `shkriuss.android.room`: Room 3 in a library module, on the system
 * SQLite (ADR 0004, ADR 0026). Apply it after the library plugin and the
 * unit-test plugin.
 *
 * - Room's compiler runs through KSP. Its warnings are errors, like the
 *   Kotlin compiler's.
 * - The schema of every database version is committed in the module's
 *   `schemas/` folder. `checkRoomSchemas`, part of `check`, fails when the
 *   code produces a schema that is not committed as it is
 *   ([CheckRoomSchemasTask]). `recordRoomSchemas` writes the files.
 * - Unit tests read the committed schemas as assets, so the migration tests
 *   of `core/testing` can create a database at any old version.
 * - Only `AndroidSQLiteDriver` from `androidx.sqlite:sqlite-framework` is
 *   added. [configureAndroidCommon] refuses the bundled SQLite driver in
 *   every module.
 */
class AndroidRoomConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            androidExtension("shkriuss.android.room")
            pluginManager.apply("com.google.devtools.ksp")
            pluginManager.apply("androidx.room3")

            extensions.configure<RoomExtension> {
                schemaDirectory(layout.projectDirectory.dir(SCHEMA_DIR))
            }
            extensions.configure<KspExtension> {
                allWarningsAsErrors = true
            }

            registerSchemaTasks()
            registerDaoRulesCheck()
            addSchemasToUnitTestAssets()

            dependencies {
                add("implementation", libs.library("room-runtime"))
                add("implementation", libs.library("sqlite-framework"))
                add("ksp", libs.library("room-compiler"))
                add("testImplementation", libs.library("room-testing"))
            }
        }
    }

    /**
     * Replaces Room's own copy, which writes over the committed schema files,
     * with a check and an explicit record task.
     */
    private fun Project.registerSchemaTasks() {
        val roomCopy = tasks.named<RoomSchemaCopyTask>(ROOM_COPY_TASK)
        roomCopy.configure { enabled = false }
        val generated = roomCopy.flatMap { it.apTaskSchemaOutputDirectories }
        val committed = layout.projectDirectory.dir(SCHEMA_DIR)
        // Room's plugin passes a schema folder to every KSP and Java compile
        // task of the module. Each writes there.
        val compilers = listOf(tasks.withType<KspAATask>(), tasks.withType<JavaCompile>())

        val check = tasks.register<CheckRoomSchemasTask>("checkRoomSchemas") {
            group = "verification"
            description = "Checks that the database schemas the code produces are the committed ones."
            generatedDirectories.set(generated)
            committedDirectory.set(committed)
            report.set(layout.buildDirectory.file("reports/room-schemas/check.txt"))
            dependsOn(compilers)
        }
        tasks.named { it == "check" }.configureEach { dependsOn(check) }

        tasks.register<Copy>("recordRoomSchemas") {
            group = "verification"
            description = "Writes the database schemas the code produces to schemas/, to commit them."
            from(generated)
            into(committed)
            // Every compile task of a database writes the same file.
            // checkRoomSchemas fails if two of them differ.
            duplicatesStrategy = DuplicatesStrategy.INCLUDE
            dependsOn(compilers)
        }
    }

    /**
     * Fails `check` when code of the module, in main or test code, could
     * remove records for good or write past RecordWriter ([CheckDaoRulesTask]).
     */
    private fun Project.registerDaoRulesCheck() {
        val check = tasks.register<CheckDaoRulesTask>("checkDaoRules") {
            group = "verification"
            description = "Checks that no DAO writes or deletes records, and only RecordWriter calls rawInsert and rawUpdate."
            // Every Kotlin compile task of the module: main and unit tests,
            // debug and release. Their outputs are the compiled classes.
            classes.from(tasks.withType<KotlinJvmCompile>())
            report.set(layout.buildDirectory.file("reports/dao-rules/check.txt"))
        }
        tasks.named { it == "check" }.configureEach { dependsOn(check) }
    }

    private fun Project.addSchemasToUnitTestAssets() {
        val schemas = layout.projectDirectory.dir(SCHEMA_DIR).asFile.path
        extensions.configure<LibraryAndroidComponentsExtension> {
            onVariants { variant ->
                variant.hostTests[HostTestBuilder.UNIT_TEST_TYPE]
                    ?.sources?.assets?.addStaticSourceDirectory(schemas)
            }
        }
    }

    private companion object {
        /** Where the schemas are committed, relative to the module. */
        const val SCHEMA_DIR = "schemas"

        /** The task the Room Gradle plugin registers for one schema folder. */
        const val ROOM_COPY_TASK = "copyRoomSchemas"
    }
}
