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
 * - Rule 3: no use of Google Play services. This checks for the emoji font
 *   loader, which asks a system font provider for a font, and for any class
 *   under `com.google.android.gms` in the APK's dex files.
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
        val problems = manifestProblems(mergedManifest.get().asFile) + nativeLibraryProblems() +
            playServicesClassProblems()
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
        report.get().asFile.writeText(
            "No permissions, no native libraries, no emoji font loader, no Play services classes.\n",
        )
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

    /**
     * Rule 3: no class under `com.google.android.gms`, the package of
     * Google Play services, in any dex file of the APK.
     *
     * A dex file names every class the APK holds, and every class its code
     * refers to, by a descriptor such as `Lcom/google/android/gms/Foo;`.
     * This searches the bytes of every dex file for the start of such a
     * descriptor. It does not search for the dotted form: AndroidX holds
     * plain text such as `com.google.android.gms.provider.action.PICK_IMAGES`,
     * the name of a system action, which is no class.
     *
     * How it still finds a class after R8:
     * - This build never renames. `-dontobfuscate` is set for `release`
     *   and `preview` in `build-logic/r8/app-rules.pro`, so a class that
     *   stays in the APK keeps its real name. If that setting is ever
     *   removed, this rule must read the classes before R8 instead, as
     *   [CheckGraphicsPathUseTask] does.
     * - R8 can only rename a class that is inside the APK. A class the
     *   code only refers to always keeps its name.
     * - The same rule runs on a debug APK, which R8 never touches.
     *
     * An APK with no dex file fails too, so the rule never passes by
     * reading nothing.
     */
    private fun playServicesClassProblems(): List<String> {
        val artifacts = builtArtifactsLoader.get().load(apkFolder.get())
            ?: throw GradleException("No APK found in ${apkFolder.get().asFile}")
        return artifacts.elements.flatMap { element ->
            val apk = File(element.outputFile)
            ZipFile(apk).use { zip ->
                val dexFiles = zip.entries().asSequence().filter { it.name.endsWith(".dex") }.toList()
                if (dexFiles.isEmpty()) {
                    listOf("no dex file in ${apk.name}, so its classes cannot be checked (rule 3)")
                } else {
                    dexFiles.flatMap { dexFile ->
                        val classes = playServicesClasses(zip.getInputStream(dexFile).use { it.readBytes() })
                        val shown = classes.take(MOST_CLASSES_SHOWN).map { name ->
                            "class $name in ${dexFile.name} of ${apk.name} (rule 3: no Google Play services)"
                        }
                        val more = classes.size - MOST_CLASSES_SHOWN
                        if (more > 0) shown + "and $more more such classes in ${dexFile.name} of ${apk.name}" else shown
                    }
                }
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
        /** How a dex file starts the name of every class of Google Play services. */
        const val PLAY_SERVICES_DESCRIPTOR = "Lcom/google/android/gms/"

        /** A failing build names this many classes for each dex file, and counts the rest. */
        const val MOST_CLASSES_SHOWN = 20

        /** A class name longer than this is cut. No real name comes close. */
        const val LONGEST_CLASS_NAME = 300

        /**
         * The names of the Play services classes that the bytes of one dex
         * file name, in dotted form, sorted, each once.
         */
        fun playServicesClasses(dex: ByteArray): List<String> {
            val pattern = PLAY_SERVICES_DESCRIPTOR.toByteArray(Charsets.US_ASCII)
            val found = sortedSetOf<String>()
            var start = 0
            while (start <= dex.size - pattern.size) {
                if (pattern.indices.all { dex[start + it] == pattern[it] }) {
                    var end = start + pattern.size
                    while (end < dex.size && end - start < LONGEST_CLASS_NAME && isDescriptorByte(dex[end])) end++
                    // Without the leading "L". The ";" that ends a descriptor is not part of the name.
                    found += String(dex, start + 1, end - start - 1, Charsets.US_ASCII).replace('/', '.')
                    start = end
                } else {
                    start++
                }
            }
            return found.toList()
        }

        /** True for a byte that can be part of a class name inside a descriptor. */
        private fun isDescriptorByte(byte: Byte): Boolean {
            val char = byte.toInt().toChar()
            return char.isLetterOrDigit() || char == '/' || char == '$' || char == '_' || char == '-'
        }

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
