package app.shkriuss.buildlogic

import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.dependencies

/**
 * Plugin `shkriuss.android.instrumented-test`: tests that run on an
 * emulator, in `src/androidTest/`. Apply it after the library plugin and
 * `shkriuss.android.unit-test`.
 *
 * - The tests are JUnit 4 tests, run by the project's own small runner in
 *   `core/testing` (ADR 0028). No test library is added for them.
 * - The runner runs one class: the JUnit suite `InstrumentedTests` in the
 *   module's own package. A test class that the suite does not list does
 *   not run.
 * - Tests in `src/sharedTest/` run twice: on the JVM with the unit tests,
 *   and on the emulator. Put a test there when it needs no emulator but
 *   its answer could differ on a real Android.
 * - Nothing here starts an emulator. The job "Emulator" in
 *   `.github/workflows/ci.yml` builds the test APK, starts the emulator
 *   and runs the tests (docs/development/emulator-tests.md).
 */
class AndroidInstrumentedTestConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            val android = androidExtension("shkriuss.android.instrumented-test")
            android.defaultConfig.testInstrumentationRunner = RUNNER
            android.sourceSets.getByName("test").kotlin.directories += SHARED_TESTS
            android.sourceSets.getByName("androidTest").kotlin.directories += SHARED_TESTS

            dependencies {
                add("androidTestImplementation", libs.library("junit"))
                add("androidTestImplementation", project(":core:testing"))
            }
        }
    }

    private companion object {
        /** The runner in `core/testing`. */
        const val RUNNER = "app.shkriuss.core.testing.InstrumentedTestRunner"

        /** Tests that run on the JVM and on the emulator. */
        const val SHARED_TESTS = "src/sharedTest/kotlin"
    }
}
