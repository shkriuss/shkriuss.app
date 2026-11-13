package app.shkriuss.buildlogic

import com.android.build.api.artifact.ScopedArtifact
import com.android.build.api.artifact.SingleArtifact
import com.android.build.api.variant.ScopedArtifacts
import com.android.build.api.dsl.ApplicationExtension
import com.android.build.api.variant.ApplicationAndroidComponentsExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.register

/**
 * Plugin `shkriuss.android.application`: the build config of every app
 * module in `app/`.
 *
 * Build types:
 * - `debug` for development and tests.
 * - `release`, shrunk and optimised by R8 but not renamed, and left
 *   unsigned. The release workflow signs it.
 * - `preview`, the same as `release` with the application ID suffix
 *   `.preview`, so it installs next to the real app. The preview workflow
 *   signs it with a throwaway key (section 13 of docs/plan/PLAN.md).
 *
 * Every assembled APK is checked by [CheckApkRulesTask], and every app's
 * classes by [CheckGraphicsPathUseTask]. `check` also runs the tests of the
 * build checks in `build-logic`. The reproducible-build settings are
 * explained in docs/development/build.md.
 */
class AndroidApplicationConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("com.android.application")

            extensions.configure<ApplicationExtension> {
                configureAndroidCommon(this)
                defaultConfig.targetSdk = ShkBuild.TARGET_SDK

                buildTypes {
                    getByName("release") {
                        isMinifyEnabled = true
                        isShrinkResources = true
                        // R8 shrinks and optimises, but never renames. It
                        // keeps the source file and line number attributes
                        // for the mapping file. See r8/app-rules.pro.
                        proguardFiles(
                            getDefaultProguardFile("proguard-android-optimize.txt"),
                            isolated.rootProject.projectDirectory.file(R8_RULES).asFile,
                        )
                        // The commit ID would make the APK depend on the Git
                        // checkout, not only on the source files.
                        vcsInfo.include = false
                    }
                    create("preview") {
                        initWith(getByName("release"))
                        applicationIdSuffix = ".preview"
                        versionNameSuffix = "-preview"
                        vcsInfo.include = false
                        // Library modules have no preview build type.
                        matchingFallbacks += "release"
                    }
                }

                // AGP would add a list of dependencies to signed APKs,
                // encrypted so that only Google Play can read it. Nobody
                // else can check what is in it. Leave it out.
                dependenciesInfo {
                    includeInApk = false
                    includeInBundle = false
                }

                // Compose UI depends on androidx.graphics:graphics-path,
                // which ships a small JNI library. Hard rule 2 allows no
                // native code, and the owner decided against an exception.
                // Compose only loads it when code walks through a Path;
                // CheckGraphicsPathUseTask fails the build if any code can.
                // See docs/development/build.md, "Native code from Compose".
                packaging.jniLibs.excludes += "**/libandroidx.graphics.path.so"
            }

            registerApkRulesCheck()
            registerGraphicsPathUseCheck()
            runBuildCheckTestsInCheck()
        }
    }

    private companion object {
        /** The R8 rules every app shares, relative to `android/`. */
        const val R8_RULES = "build-logic/r8/app-rules.pro"

        /** The included build that holds the convention plugins and the tests of the build checks. */
        const val BUILD_LOGIC = "build-logic"
    }

    /**
     * The build checks have their own tests in `build-logic`, a build of its
     * own. `check` runs them, so CI's `check` fails when a check no longer
     * fails on a sample that breaks its rule.
     */
    private fun Project.runBuildCheckTestsInCheck() {
        val buildCheckTests = gradle.includedBuild(BUILD_LOGIC).task(":test")
        tasks.named { it == "check" }.configureEach { dependsOn(buildCheckTests) }
    }

    private fun Project.registerGraphicsPathUseCheck() {
        extensions.configure<ApplicationAndroidComponentsExtension> {
            onVariants { variant ->
                val variantName = variant.name.replaceFirstChar { it.uppercase() }
                val check = tasks.register<CheckGraphicsPathUseTask>("check${variantName}GraphicsPathUse") {
                    group = "verification"
                    description = "Checks that no ${variant.name} class can reach androidx.graphics.path."
                    report.set(layout.buildDirectory.file("reports/graphics-path-use/${variant.name}.txt"))
                }
                variant.artifacts.forScope(ScopedArtifacts.Scope.ALL)
                    .use(check)
                    .toGet(ScopedArtifact.CLASSES, CheckGraphicsPathUseTask::jars, CheckGraphicsPathUseTask::directories)
                tasks.named { it == "assemble$variantName" }.configureEach { dependsOn(check) }
                if (variant.buildType == ShkBuild.TEST_BUILD_TYPE) {
                    tasks.named { it == "check" }.configureEach { dependsOn(check) }
                }
            }
        }
    }

    private fun Project.registerApkRulesCheck() {
        val app = name
        extensions.configure<ApplicationAndroidComponentsExtension> {
            onVariants { variant ->
                val variantName = variant.name.replaceFirstChar { it.uppercase() }
                val check = tasks.register<CheckApkRulesTask>("check${variantName}ApkRules") {
                    group = "verification"
                    description = "Checks the ${variant.name} APK for permissions, native code, Play services, " +
                        "backup and, in an APK that ships, WebView and code loading."
                    apkFolder.set(variant.artifacts.get(SingleArtifact.APK))
                    builtArtifactsLoader.set(variant.artifacts.getBuiltArtifactsLoader())
                    mergedManifest.set(variant.artifacts.get(SingleArtifact.MERGED_MANIFEST))
                    appName.set(app)
                    applicationId.set(variant.applicationId)
                    // Every build type but debug ships: release and preview today.
                    shipped.set(variant.buildType != ShkBuild.TEST_BUILD_TYPE)
                    report.set(layout.buildDirectory.file("reports/apk-rules/${variant.name}.txt"))
                }
                tasks.named { it == "assemble$variantName" }.configureEach { dependsOn(check) }
            }
        }
    }
}
