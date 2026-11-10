package app.shkriuss.buildlogic

import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.dependencies

/**
 * Plugin `shkriuss.android.compose`: Jetpack Compose for a module. Apply it
 * after the application or library plugin.
 *
 * It adds the Compose compiler and the Compose BOM, so modules name Compose
 * libraries without versions. It also adds the Compose test libraries to
 * unit tests.
 */
class AndroidComposeConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            val android = androidExtension("shkriuss.android.compose")
            pluginManager.apply("org.jetbrains.kotlin.plugin.compose")
            android.buildFeatures.compose = true

            dependencies {
                val bom = platform(libs.library("compose-bom"))
                add("implementation", bom)
                add("testImplementation", bom)
                add("testImplementation", libs.library("compose-ui-test-junit4"))
                constraints {
                    add("testImplementation", libs.library("espresso-core")) {
                        because("Espresso 3.5, which Compose UI tests ask for, fails on the Android 17 image")
                    }
                }
            }
        }
    }
}
