package app.shkriuss.buildlogic

import java.io.File
import java.util.zip.ZipFile
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.Directory
import org.gradle.api.file.RegularFile
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.ListProperty
import org.gradle.api.tasks.Classpath
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.TaskAction

/**
 * Fails the build when any class an app runs could reach the native library
 * of `androidx.graphics:graphics-path`.
 *
 * Compose UI depends on that library, which ships a JNI library. The build
 * leaves the JNI library out of every APK (hard rule 2, ADR 0011). Code
 * that walks through a `Path` would then crash with `UnsatisfiedLinkError`
 * on every Android version. This check turns that crash into a build
 * failure.
 *
 * It reads every class of the app's runtime classpath: the app's own
 * classes and every library. A class fails the check if it refers to one
 * of [TARGETS], unless it is one of the classes that define them: the
 * targets themselves, their nested classes, and [OTHER_DEFINING_CLASSES].
 */
abstract class CheckGraphicsPathUseTask : DefaultTask() {
    /** Every jar on the app's runtime classpath. */
    @get:Classpath
    abstract val jars: ListProperty<RegularFile>

    /** Every class folder on the app's runtime classpath. */
    @get:Classpath
    abstract val directories: ListProperty<Directory>

    /** Written when the check passes, so Gradle can skip the task next time. */
    @get:OutputFile
    abstract val report: RegularFileProperty

    @TaskAction
    fun check() {
        val findings = sortedSetOf<String>()
        var classCount = 0
        jars.get().forEach { jar ->
            ZipFile(jar.asFile).use { zip ->
                zip.entries().asSequence()
                    .filter { !it.isDirectory && it.name.endsWith(".class") }
                    .forEach { entry ->
                        classCount++
                        val bytes = zip.getInputStream(entry).use { it.readBytes() }
                        findings += problems(className(entry.name), bytes, jar.asFile)
                    }
            }
        }
        directories.get().forEach { directory ->
            val root = directory.asFile
            root.walkTopDown()
                .filter { it.isFile && it.name.endsWith(".class") }
                .forEach { file ->
                    classCount++
                    findings += problems(className(file.relativeTo(root).invariantSeparatorsPath), file.readBytes(), root)
                }
        }
        if (findings.isNotEmpty()) {
            throw GradleException(failureMessage(findings))
        }
        report.get().asFile.writeText("Checked $classCount classes. None can reach androidx.graphics.path.\n")
    }

    private fun problems(className: String, bytes: ByteArray, source: File): List<String> {
        if (isDefiningClass(className)) return emptyList()
        return TARGETS
            .filter { target -> refersTo(bytes, target) }
            .map { target -> "${className.replace('/', '.')} refers to ${target.trimEnd('/').replace('/', '.')} (in $source)" }
    }

    private fun failureMessage(findings: Set<String>): String = buildString {
        appendLine("Code in this app can reach androidx.graphics:graphics-path.")
        appendLine("Its native library is left out of the APK (hard rule 2, ADR 0011),")
        appendLine("so this code would crash with UnsatisfiedLinkError on every Android version.")
        findings.forEach { appendLine("- $it") }
        appendLine("Stop and ask the owner. Do not add the native library back, do not")
        appendLine("change this check, and do not work around it to make the build pass.")
        append("See docs/development/build.md, \"Native code from Compose\".")
    }

    internal companion object {
        /**
         * What no class may refer to, as JVM internal names. A name ending
         * in `/` is a whole package. Nested classes of a target count as the
         * target.
         */
        val TARGETS = listOf(
            "androidx/graphics/path/",
            "androidx/compose/ui/graphics/PathIterator",
            "androidx/compose/ui/graphics/AndroidPathIterator",
            "androidx/compose/ui/graphics/PathHitTester",
            "androidx/compose/ui/graphics/PathGeometryKt",
            "androidx/compose/ui/graphics/PathSvgKt",
            "androidx/compose/animation/core/PathEasing",
        )

        /**
         * Classes in Compose that are not targets, but are part of how the
         * targets are defined. Code that calls what they declare names a
         * target in its own class file, because a JVM method reference
         * carries its return type. So that code is still caught.
         */
        val OTHER_DEFINING_CLASSES = setOf(
            // Declares Path.iterator(), which returns a PathIterator.
            "androidx/compose/ui/graphics/Path",
            "androidx/compose/ui/graphics/Path\$DefaultImpls",
            // Same source file as AndroidPathIterator. Holds the
            // PathIterator(...) factory, which returns a PathIterator.
            "androidx/compose/ui/graphics/AndroidPathIterator_androidKt",
            "androidx/compose/ui/graphics/AndroidPathIterator_androidKt\$WhenMappings",
            // Same source file as PathHitTester. Holds the PathHitTester(...)
            // factory, which returns a PathHitTester.
            "androidx/compose/ui/graphics/PathHitTesterKt",
        )

        /** True for the classes that define the targets, which may refer to them. */
        fun isDefiningClass(className: String): Boolean =
            className in OTHER_DEFINING_CLASSES || TARGETS.any { target ->
                if (target.endsWith("/")) {
                    className.startsWith(target)
                } else {
                    className == target || className.startsWith("$target$")
                }
            }

        /**
         * True if the class file mentions the target, in a class reference, a
         * type descriptor, a signature or a string, with `/` or `.` between
         * the parts of the name.
         */
        fun refersTo(bytes: ByteArray, target: String): Boolean =
            listOf(target, target.replace('/', '.')).any { form ->
                val pattern = form.toByteArray(Charsets.US_ASCII)
                val isPackage = form.endsWith("/") || form.endsWith(".")
                indicesOf(bytes, pattern).any { end -> isPackage || !isIdentifierPart(bytes.getOrNull(end)) }
            }

        /** The positions just after each place where [pattern] occurs in [bytes]. */
        private fun indicesOf(bytes: ByteArray, pattern: ByteArray): Sequence<Int> = sequence {
            var start = 0
            while (start <= bytes.size - pattern.size) {
                var matches = true
                for (offset in pattern.indices) {
                    if (bytes[start + offset] != pattern[offset]) {
                        matches = false
                        break
                    }
                }
                if (matches) yield(start + pattern.size)
                start++
            }
        }

        /** True if the byte could continue a Java name, so the match is only a prefix. */
        private fun isIdentifierPart(byte: Byte?): Boolean {
            if (byte == null) return false
            val char = byte.toInt().toChar()
            return char.isLetterOrDigit() || char == '_'
        }

        /** `a/b/C.class` or `META-INF/versions/11/a/b/C.class` to `a/b/C`. */
        fun className(path: String): String =
            path.removeSuffix(".class").replace(Regex("^META-INF/versions/\\d+/"), "")
    }
}
