package app.shkriuss.buildlogic

import com.android.build.api.dsl.LibraryExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure

/**
 * Plugin `shkriuss.android.test-fixtures`: test helpers that the tests of
 * other modules may use, in `src/testFixtures/`. Apply it after the
 * library plugin.
 *
 * - Code in `src/testFixtures/` sees the `internal` declarations of the
 *   module's own code. So it can build what a test needs from parts that
 *   no other module may touch.
 * - Another module uses it only in its tests:
 *   `testImplementation(testFixtures(project(":core:crypto")))`.
 * - Test fixtures are never part of an app. They are not in the module's
 *   library, and no app module may depend on them. For the fixtures of
 *   `core/crypto`, the APK rules check enforces that (ADR 0029).
 */
class AndroidTestFixturesConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.withPlugin("com.android.library") {
                extensions.configure<LibraryExtension> {
                    testFixtures.enable = true
                }
            }
        }
    }
}
