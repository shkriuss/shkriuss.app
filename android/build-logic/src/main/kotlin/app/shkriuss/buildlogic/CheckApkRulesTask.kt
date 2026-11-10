package app.shkriuss.buildlogic

import com.android.build.api.variant.BuiltArtifactsLoader
import java.io.File
import java.util.zip.ZipFile
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.w3c.dom.Element

/**
 * Fails the build when an APK breaks a hard rule in CLAUDE.md that a library
 * could break without anyone noticing:
 *
 * - Rule 2: no native libraries (`.so` files).
 * - Rule 3: no use of Google Play services. Today this checks for the emoji
 *   font loader, which asks a system font provider for a font.
 * - Rule 4, and "no permissions" for every app so far: no permission is
 *   declared or requested.
 *
 * It runs every time an APK is assembled. Apps that are later allowed an
 * exception (Sync and the network permission, Grammar and native code) get
 * an explicit allow list here, decided in their ADR.
 */
abstract class CheckApkRulesTask : DefaultTask() {
    /** The folder AGP writes the variant's APK to. */
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val apkFolder: DirectoryProperty

    /** Reads the list of APK files in [apkFolder]. */
    @get:Internal
    abstract val builtArtifactsLoader: Property<BuiltArtifactsLoader>

    /** The variant's final merged manifest, as packaged in the APK. */
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val mergedManifest: RegularFileProperty

    /** Written when every check passes, so Gradle can skip the task next time. */
    @get:OutputFile
    abstract val report: RegularFileProperty

    @TaskAction
    fun check() {
        val problems = manifestProblems(mergedManifest.get().asFile) + nativeLibraryProblems()
        if (problems.isNotEmpty()) {
            throw GradleException(
                buildString {
                    appendLine("This APK breaks the hard rules in CLAUDE.md:")
                    problems.forEach { appendLine("- $it") }
                    append("A library may have added this. Remove it in the app's manifest or packaging, ")
                    append("or stop and ask the owner. Never ship it to make a build pass.")
                },
            )
        }
        report.get().asFile.writeText("No permissions, no native libraries, no emoji font loader.\n")
    }

    private fun nativeLibraryProblems(): List<String> {
        val artifacts = builtArtifactsLoader.get().load(apkFolder.get())
            ?: throw GradleException("No APK found in ${apkFolder.get().asFile}")
        return artifacts.elements.flatMap { element ->
            val apk = File(element.outputFile)
            ZipFile(apk).use { zip ->
                zip.entries().asSequence()
                    .map { it.name }
                    .filter { it.endsWith(".so") }
                    .map { "native library $it in ${apk.name} (rule 2)" }
                    .toList()
            }
        }
    }

    private fun manifestProblems(manifest: File): List<String> {
        val factory = DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = true
            setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
            setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        }
        val document = factory.newDocumentBuilder().parse(manifest)
        val problems = mutableListOf<String>()
        for (tag in PERMISSION_TAGS) {
            val nodes = document.getElementsByTagName(tag)
            for (index in 0 until nodes.length) {
                val name = (nodes.item(index) as Element).getAttributeNS(ANDROID_NAMESPACE, "name")
                problems += "<$tag> $name in the manifest (rule 4: no permissions)"
            }
        }
        val metaData = document.getElementsByTagName("meta-data")
        for (index in 0 until metaData.length) {
            val name = (metaData.item(index) as Element).getAttributeNS(ANDROID_NAMESPACE, "name")
            if (name == EMOJI_INITIALIZER) {
                problems += "$name in the manifest (rule 3: it asks a system font provider, " +
                    "usually Google Play services, for a font)"
            }
        }
        return problems
    }

    private companion object {
        const val ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android"
        const val EMOJI_INITIALIZER = "androidx.emoji2.text.EmojiCompatInitializer"
        val PERMISSION_TAGS = listOf(
            "uses-permission",
            "uses-permission-sdk-23",
            "permission",
            "permission-group",
            "permission-tree",
        )
    }
}
