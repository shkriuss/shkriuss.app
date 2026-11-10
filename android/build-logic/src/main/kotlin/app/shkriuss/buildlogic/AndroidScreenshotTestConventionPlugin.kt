package app.shkriuss.buildlogic

import io.github.takahirom.roborazzi.RoborazziExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies

/**
 * Plugin `shkriuss.android.screenshot-test`: Roborazzi screenshot tests on
 * the JVM. Apply it after the application or library plugin and the Compose
 * plugin. It also applies `shkriuss.android.unit-test`.
 *
 * The reference images live in `src/test/screenshots/` of each module.
 * `recordRoborazziDebug` writes them and `verifyRoborazziDebug` compares
 * against them.
 */
class AndroidScreenshotTestConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            androidExtension("shkriuss.android.screenshot-test")
            pluginManager.apply(AndroidUnitTestConventionPlugin::class.java)
            pluginManager.apply("io.github.takahirom.roborazzi")

            extensions.configure<RoborazziExtension> {
                outputDir.set(layout.projectDirectory.dir(SCREENSHOT_DIR))
            }

            dependencies {
                add("testImplementation", libs.library("roborazzi"))
            }
        }
    }

    private companion object {
        const val SCREENSHOT_DIR = "src/test/screenshots"
    }
}
