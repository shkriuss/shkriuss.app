package app.shkriuss.buildlogic

import com.android.build.api.variant.ApplicationAndroidComponentsExtension
import com.android.build.api.variant.HostTestBuilder
import com.android.build.api.variant.LibraryAndroidComponentsExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.file.FileCollection
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.testing.Test
import org.gradle.api.tasks.testing.logging.TestExceptionFormat
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies
import org.gradle.kotlin.dsl.withType
import org.gradle.process.CommandLineArgumentProvider

/**
 * Plugin `shkriuss.android.unit-test`: JVM unit tests with JUnit 4 and
 * Robolectric. Apply it after the application or library plugin.
 *
 * - Tests run for the debug build type only. The release and preview build
 *   types compile the same Kotlin code, and R8 does not run for unit tests,
 *   so running the tests again for them would test nothing new.
 * - Robolectric runs offline. Gradle downloads its Android image like any
 *   other dependency, so dependency verification checks the file.
 *   Robolectric's own downloader would skip that check.
 */
class AndroidUnitTestConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            val android = androidExtension("shkriuss.android.unit-test")
            android.testOptions.unitTests.isIncludeAndroidResources = true

            runHostTestsForDebugOnly()
            configureRobolectricOffline()

            dependencies {
                add("testImplementation", libs.library("junit"))
                add("testImplementation", libs.library("robolectric"))
            }

            tasks.withType<Test>().configureEach {
                maxHeapSize = "2g"
                jvmArgs(ROBOLECTRIC_JVM_FLAGS)
                testLogging {
                    events("failed")
                    exceptionFormat = TestExceptionFormat.FULL
                }
            }
        }
    }

    private fun Project.runHostTestsForDebugOnly() {
        pluginManager.withPlugin("com.android.application") {
            extensions.configure<ApplicationAndroidComponentsExtension> {
                beforeVariants(selector().all()) { variant ->
                    if (variant.buildType != ShkBuild.TEST_BUILD_TYPE) {
                        variant.hostTests[HostTestBuilder.UNIT_TEST_TYPE]?.enable = false
                    }
                }
            }
        }
        pluginManager.withPlugin("com.android.library") {
            extensions.configure<LibraryAndroidComponentsExtension> {
                beforeVariants(selector().all()) { variant ->
                    if (variant.buildType != ShkBuild.TEST_BUILD_TYPE) {
                        variant.hostTests[HostTestBuilder.UNIT_TEST_TYPE]?.enable = false
                    }
                }
            }
        }
    }

    private fun Project.configureRobolectricOffline() {
        val declared = configurations.dependencyScope("robolectricAndroidAll")
        val resolved = configurations.resolvable("robolectricAndroidAllFiles") {
            extendsFrom(declared.get())
            isTransitive = false
        }
        dependencies {
            add(declared.name, libs.library("robolectric-android-all"))
        }
        tasks.withType<Test>().configureEach {
            jvmArgumentProviders.add(RobolectricOfflineArguments(resolved.get()))
        }
    }

    private companion object {
        /**
         * Robolectric 4.17 on JDK 21 reads file descriptor internals. Without
         * this flag every test fails with "Failed to interact with raw
         * FileDescriptor internals". Checked in Phase 0, step 3.
         */
        val ROBOLECTRIC_JVM_FLAGS = listOf(
            "--add-exports=java.base/jdk.internal.access=ALL-UNNAMED",
        )
    }
}

/**
 * Tells Robolectric to load its Android image from the folder Gradle
 * downloaded it to, and never to download anything itself.
 */
internal class RobolectricOfflineArguments(
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.NONE)
    val androidAll: FileCollection,
) : CommandLineArgumentProvider {
    override fun asArguments(): Iterable<String> = listOf(
        "-Drobolectric.offline=true",
        "-Drobolectric.dependency.dir=${androidAll.singleFile.parentFile.absolutePath}",
    )
}
