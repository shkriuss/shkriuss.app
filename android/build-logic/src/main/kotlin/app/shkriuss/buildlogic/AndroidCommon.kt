package app.shkriuss.buildlogic

import com.android.build.api.dsl.CommonExtension
import org.gradle.api.Project
import org.gradle.kotlin.dsl.findByType
import org.gradle.kotlin.dsl.withType
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile

/**
 * Settings every Android module shares: SDK levels, bytecode level, lint
 * and compiler warnings. Called by the application and library plugins.
 */
internal fun Project.configureAndroidCommon(android: CommonExtension) {
    android.compileSdk = ShkBuild.COMPILE_SDK
    android.buildToolsVersion = ShkBuild.BUILD_TOOLS
    android.defaultConfig.minSdk = ShkBuild.MIN_SDK

    android.compileOptions.sourceCompatibility = ShkBuild.JAVA_VERSION
    android.compileOptions.targetCompatibility = ShkBuild.JAVA_VERSION

    android.lint.abortOnError = true
    android.lint.warningsAsErrors = true
    android.lint.checkReleaseBuilds = true
    // Owner decision on pull request 5, not a precedent for turning off
    // other checks. These three look up the newest versions online while
    // lint runs. Their result depends on the date and the network, not on
    // the code, so the same commit could pass today and fail tomorrow.
    // Updates are handled by prompt R5 in docs/development/PROMPTS.md.
    android.lint.disable += setOf(
        "GradleDependency",
        "NewerVersionAvailable",
        "AndroidGradlePluginVersion",
    )

    tasks.withType<KotlinJvmCompile>().configureEach {
        compilerOptions.allWarningsAsErrors.set(true)
    }

    // Lifecycle publishes version alignment, so this lifts every Lifecycle
    // module, not only this one.
    dependencies.constraints.add("implementation", libs.library("lifecycle-runtime")) {
        because("the lint checks in Lifecycle 2.9 do not load in this lint version")
    }
}

/**
 * The Android extension of this module. The application or library plugin
 * must be applied first.
 */
internal fun Project.androidExtension(pluginName: String): CommonExtension =
    extensions.findByType<CommonExtension>()
        ?: error("$pluginName needs shkriuss.android.application or shkriuss.android.library first")
