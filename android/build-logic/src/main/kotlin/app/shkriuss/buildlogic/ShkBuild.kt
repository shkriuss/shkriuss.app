package app.shkriuss.buildlogic

import org.gradle.api.JavaVersion
import org.gradle.api.Project
import org.gradle.api.artifacts.MinimalExternalModuleDependency
import org.gradle.api.artifacts.VersionCatalog
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.gradle.api.provider.Provider
import org.gradle.kotlin.dsl.getByType

/**
 * Build numbers shared by every Android module, kept in one place so they
 * always change together. See ADR 0002 for the SDK levels, and ADR 0040
 * for the minimum.
 */
internal object ShkBuild {
    /** Android 15. */
    const val MIN_SDK = 35

    /** Android 17. Built against the SDK platform `android-37.0`. */
    const val COMPILE_SDK = 37

    /** Android 17. */
    const val TARGET_SDK = 37

    /**
     * SDK build tools. The default of AGP 9.5.1, pinned so an AGP update
     * cannot change it unnoticed. The cloud setup script installs it.
     */
    const val BUILD_TOOLS = "36.0.0"

    /** Bytecode level for Kotlin and Java. D8 turns it into Android code. */
    val JAVA_VERSION: JavaVersion = JavaVersion.VERSION_17

    /** The only build type that runs unit and screenshot tests. */
    const val TEST_BUILD_TYPE = "debug"

    /**
     * The manifest placeholder that names the handover permission of
     * `core/security` (ADR 0041). Each app sets it per build type; the unit
     * tests of a library set it to [HANDOVER_PERMISSION].
     */
    const val HANDOVER_PERMISSION_PLACEHOLDER = "shkHandoverPermission"

    /** The handover permission of debug and release builds (ADR 0041, point 6). */
    const val HANDOVER_PERMISSION = "app.shkriuss.permission.HANDOVER"

    /** The handover permission of preview builds, so that a preview installs next to the real app (ADR 0041, point 21). */
    const val HANDOVER_PERMISSION_PREVIEW = "app.shkriuss.permission.HANDOVER_PREVIEW"
}

/** The version catalog in `gradle/libs.versions.toml`. */
internal val Project.libs: VersionCatalog
    get() = extensions.getByType<VersionCatalogsExtension>().named("libs")

/** One library from the version catalog. Fails the build if the alias is missing. */
internal fun VersionCatalog.library(alias: String): Provider<MinimalExternalModuleDependency> =
    findLibrary(alias).orElseThrow { IllegalStateException("No library '$alias' in libs.versions.toml") }
