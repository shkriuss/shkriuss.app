package app.shkriuss.buildlogic

import com.android.build.api.dsl.CommonExtension
import org.gradle.api.GradleException
import org.gradle.api.Project
import org.gradle.api.artifacts.ProjectDependency
import org.gradle.kotlin.dsl.findByType
import org.gradle.kotlin.dsl.register
import org.gradle.kotlin.dsl.withType
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile

/**
 * Settings every Android module shares: SDK levels, bytecode level, lint
 * and compiler warnings, and the logging check. Called by the application
 * and library plugins.
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

    refuseBundledSqlite()
    registerNoLoggingCheck()
    refuseCoreTestingOutsideTests()
}

/**
 * Fails `check` when the module's main code could write to a log (hard
 * rule 10, [CheckNoLoggingTask]). `core/testing` holds test helpers only, so
 * it is test code and is not checked. [refuseCoreTestingOutsideTests] makes
 * sure it never reaches an app (owner's decision in step 1.9).
 */
private fun Project.registerNoLoggingCheck() {
    val module = path
    if (module == CORE_TESTING) return
    val check = tasks.register<CheckNoLoggingTask>("checkNoLogging") {
        group = "verification"
        description = "Checks that the module's main code never logs or prints (hard rule 10)."
        modulePath.set(module)
        sourceRoot.set(layout.projectDirectory.dir("src"))
        report.set(layout.buildDirectory.file("reports/no-logging/check.txt"))
    }
    tasks.named { it == "check" }.configureEach { dependsOn(check) }
}

/**
 * Fails the build if any configuration that is not a test configuration
 * declares `core/testing`. Its main code logs on purpose, for the emulator
 * tests, and the logging check does not read it. So it may only ever be a
 * test dependency, and with this rule it can never reach an app.
 *
 * `core/testing` itself is left out: the Android Gradle Plugin adds a
 * module to the classpaths of its own tests, such as
 * `debugAndroidTestCompileClasspath`. That is the module under test, not a
 * use of it.
 */
internal fun Project.refuseCoreTestingOutsideTests() {
    val module = path
    if (module == CORE_TESTING) return
    configurations.configureEach {
        val configuration = name
        if (!isTestConfiguration(configuration)) {
            dependencies.configureEach {
                if (this is ProjectDependency && path == CORE_TESTING) {
                    throw GradleException(
                        "$module declares $CORE_TESTING in '$configuration'. $CORE_TESTING holds test helpers " +
                            "that log, and it may only be used by tests: testImplementation or " +
                            "androidTestImplementation. See docs/development/build.md, \"Logging check\".",
                    )
                }
            }
        }
    }
}

/** True for a configuration of test code: its name starts with `test` or `androidTest`. */
internal fun isTestConfiguration(name: String): Boolean = name.startsWith("test") || name.startsWith("androidTest")

/** The module of test helpers, which only tests may use. */
internal const val CORE_TESTING = ":core:testing"

/**
 * Fails dependency resolution if anything asks for the bundled SQLite
 * driver. It ships its own SQLite as a native library (hard rule 2,
 * ADR 0004). Databases use `AndroidSQLiteDriver`, the system SQLite. The
 * APK rules check would also catch its native library, but only when an APK
 * is built, and never in a library's unit tests.
 */
private fun Project.refuseBundledSqlite() {
    configurations.configureEach {
        resolutionStrategy.eachDependency {
            if (requested.group == SQLITE_GROUP && requested.name.startsWith(BUNDLED_SQLITE_PREFIX)) {
                throw GradleException(
                    "${requested.group}:${requested.name} is the bundled SQLite driver, which ships " +
                        "native code (hard rule 2, ADR 0004). Use AndroidSQLiteDriver, the system SQLite.",
                )
            }
        }
    }
}

private const val SQLITE_GROUP = "androidx.sqlite"
private const val BUNDLED_SQLITE_PREFIX = "sqlite-bundled"

/**
 * The Android extension of this module. The application or library plugin
 * must be applied first.
 */
internal fun Project.androidExtension(pluginName: String): CommonExtension =
    extensions.findByType<CommonExtension>()
        ?: error("$pluginName needs shkriuss.android.application or shkriuss.android.library first")
