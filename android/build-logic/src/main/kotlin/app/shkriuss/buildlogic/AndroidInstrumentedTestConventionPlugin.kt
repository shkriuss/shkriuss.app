package app.shkriuss.buildlogic

import com.android.build.api.dsl.CommonExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.dependencies
import org.gradle.kotlin.dsl.register

/**
 * Plugin `shkriuss.android.instrumented-test`: tests that run on an
 * emulator, in `src/androidTest/`. Apply it after the library plugin and
 * `shkriuss.android.unit-test`.
 *
 * - The tests are JUnit 4 tests, run by the project's own small runner in
 *   `core/testing` (ADR 0028). No test library is added for them.
 * - The runner runs one class: the JUnit suite `InstrumentedTests` in the
 *   module's own package. A test class that the suite does not list would
 *   not run. `checkInstrumentedTestSuite`, part of `check`, fails the build
 *   for such a class ([CheckInstrumentedTestSuiteTask]).
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

            registerSuiteCheck(android)
        }
    }

    /** Fails `check` when a test class is not in the suite the runner runs, or the suite lists something else. */
    private fun Project.registerSuiteCheck(android: CommonExtension) {
        val check = tasks.register<CheckInstrumentedTestSuiteTask>("checkInstrumentedTestSuite") {
            group = "verification"
            description = "Checks that the suite InstrumentedTests lists every class with @Test in src/androidTest and src/sharedTest."
            sourceFolders.from(layout.projectDirectory.dir(INSTRUMENTED_TESTS), layout.projectDirectory.dir(SHARED_TESTS_ROOT))
            // The module sets its namespace after this plugin is applied, so it is read late.
            modulePackage.set(provider { android.namespace ?: error("The module has no namespace") })
            report.set(layout.buildDirectory.file("reports/instrumented-test-suite/check.txt"))
        }
        tasks.named { it == "check" }.configureEach { dependsOn(check) }
    }

    private companion object {
        /** The runner in `core/testing`. */
        const val RUNNER = "app.shkriuss.core.testing.InstrumentedTestRunner"

        /** Tests that run on the JVM and on the emulator. */
        const val SHARED_TESTS = "src/sharedTest/kotlin"

        /** The folders the suite check reads. */
        const val INSTRUMENTED_TESTS = "src/androidTest"
        const val SHARED_TESTS_ROOT = "src/sharedTest"
    }
}
