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
import org.gradle.api.tasks.Input
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
 * - ADR 0029: no class of the test fixtures of `core/crypto`. They hold a
 *   stand-in for the Android Keystore that keeps keys in memory, and are
 *   for tests only.
 * - Android's own backup and device transfer are off (crypto-design.md,
 *   "Where keys are stored", point 1; MASVS-STORAGE-2). Read from the APK's
 *   compiled manifest and resources, as they ship ([backupProblems]).
 * - Rule 1, in the APKs that ship (every build type but `debug`): no
 *   WebView, no class loader that reads code from a file, memory or the
 *   network, and no call that loads or runs code from a file path
 *   ([shippedCodeProblems]).
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

    /** The app's module name, such as `catalog`, for the failure message. */
    @get:Input
    abstract val appName: Property<String>

    /** The variant's application ID, for the failure message. */
    @get:Input
    abstract val applicationId: Property<String>

    /**
     * True for an APK that ships: every build type but `debug`. Rules 7 to 9
     * run only on those. R8 has shrunk them, so they hold only the code an
     * app can run (owner's decision in step 1.9).
     */
    @get:Input
    abstract val shipped: Property<Boolean>

    /** Written when every check passes, so Gradle can skip the task next time. */
    @get:OutputFile
    abstract val report: RegularFileProperty

    @TaskAction
    fun check() {
        val problems = manifestProblems(mergedManifest.get().asFile) + nativeLibraryProblems() +
            playServicesClassProblems() + cryptoTestFixtureClassProblems() + apkBackupProblems() +
            (if (shipped.get()) apkShippedCodeProblems() else emptyList())
        if (problems.isNotEmpty()) {
            throw GradleException(
                buildString {
                    appendLine("This APK of ${appName.get()} (${applicationId.get()}) breaks the hard rules in CLAUDE.md:")
                    problems.forEach { appendLine("- $it") }
                    append("A library may have added this. Remove it in the app's manifest or packaging, ")
                    append("or stop and ask the owner. Never ship it to make a build pass.")
                },
            )
        }
        report.get().asFile.writeText(
            "No permissions, no native libraries, no emoji font loader, no Play services classes, " +
                "no test fixtures of core/crypto. Android backup and device transfer are off. " +
                if (shipped.get()) {
                    "No WebView, no class loader that reads code, no call that loads or runs code from a file path.\n"
                } else {
                    "Rules 7 to 9 (WebView and code loading) run only on the APKs that ship, not on debug.\n"
                },
        )
    }

    private fun apkFiles(): List<File> {
        val artifacts = builtArtifactsLoader.get().load(apkFolder.get())
            ?: throw GradleException("No APK found in ${apkFolder.get().asFile}")
        return artifacts.elements.map { File(it.outputFile) }
    }

    private fun apkBackupProblems(): List<String> = apkFiles().flatMap(::apkBackupProblems)

    private fun apkShippedCodeProblems(): List<String> = apkFiles().flatMap(::apkShippedCodeProblems)

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
    private fun playServicesClassProblems(): List<String> =
        classProblems(PLAY_SERVICES_DESCRIPTOR, "rule 3: no Google Play services", failWithoutDex = true)

    /**
     * ADR 0029: no class under `app.shkriuss.core.crypto.fixtures`, the
     * package of the test fixtures of `core/crypto`, in any dex file of the
     * APK. It is found the same way as a Play services class. An APK with
     * no dex file is already reported by that rule.
     */
    private fun cryptoTestFixtureClassProblems(): List<String> = classProblems(
        CRYPTO_TEST_FIXTURES_DESCRIPTOR,
        "ADR 0029: the test fixtures of core/crypto are for tests only and never part of an app",
        failWithoutDex = false,
    )

    /** The classes under [descriptor] that the dex files of the APK name, each as a problem that cites [rule]. */
    private fun classProblems(descriptor: String, rule: String, failWithoutDex: Boolean): List<String> {
        val artifacts = builtArtifactsLoader.get().load(apkFolder.get())
            ?: throw GradleException("No APK found in ${apkFolder.get().asFile}")
        return artifacts.elements.flatMap { element ->
            val apk = File(element.outputFile)
            ZipFile(apk).use { zip ->
                val dexFiles = zip.entries().asSequence().filter { it.name.endsWith(".dex") }.toList()
                if (dexFiles.isEmpty()) {
                    if (failWithoutDex) {
                        listOf("no dex file in ${apk.name}, so its classes cannot be checked (rule 3)")
                    } else {
                        emptyList()
                    }
                } else {
                    dexFiles.flatMap { dexFile ->
                        val classes = classesUnder(descriptor, zip.getInputStream(dexFile).use { it.readBytes() })
                        val shown = classes.take(MOST_CLASSES_SHOWN).map { name ->
                            "class $name in ${dexFile.name} of ${apk.name} ($rule)"
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

    internal companion object {
        /** How a dex file starts the name of every class of Google Play services. */
        const val PLAY_SERVICES_DESCRIPTOR = "Lcom/google/android/gms/"

        /** How a dex file starts the name of every class of the test fixtures of `core/crypto`. */
        const val CRYPTO_TEST_FIXTURES_DESCRIPTOR = "Lapp/shkriuss/core/crypto/fixtures/"

        /** A failing build names this many classes for each dex file, and counts the rest. */
        const val MOST_CLASSES_SHOWN = 20

        /** A class name longer than this is cut. No real name comes close. */
        const val LONGEST_CLASS_NAME = 300

        /**
         * The names of the classes under [descriptor] that the bytes of one
         * dex file name, in dotted form, sorted, each once.
         */
        fun classesUnder(descriptor: String, dex: ByteArray): List<String> {
            val pattern = descriptor.toByteArray(Charsets.US_ASCII)
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

        /** Rule 6 for one APK file. A file it cannot read is a problem, never a pass. */
        fun apkBackupProblems(apk: File): List<String> = ZipFile(apk).use { zip ->
            try {
                backupProblems { path -> zip.getEntry(path)?.let { entry -> zip.getInputStream(entry).use { it.readBytes() } } }
                    .map { "$it, in ${apk.name} ($BACKUP_RULE)" }
            } catch (unreadable: RuntimeException) {
                listOf("the backup settings of ${apk.name} cannot be read: ${unreadable.message} ($BACKUP_RULE)")
            }
        }

        /** Rules 7 to 9 for every dex file of one APK file. A dex file it cannot read is a problem, never a pass. */
        fun apkShippedCodeProblems(apk: File): List<String> = ZipFile(apk).use { zip ->
            val dexFiles = zip.entries().asSequence().filter { it.name.endsWith(".dex") }.toList()
            if (dexFiles.isEmpty()) return@use listOf("no dex file in ${apk.name}, so its code cannot be checked ($CALL_RULE)")
            dexFiles.flatMap { dexFile ->
                val bytes = zip.getInputStream(dexFile).use { it.readBytes() }
                try {
                    shippedCodeProblems(bytes).map { "$it, in ${dexFile.name} of ${apk.name}" }
                } catch (unreadable: RuntimeException) {
                    listOf("${dexFile.name} of ${apk.name} cannot be read: ${unreadable.message} ($CALL_RULE)")
                }
            }
        }

        /** The names of rule 6, as failure messages cite it. */
        const val BACKUP_RULE = "rule 6: Android's own backup and device transfer must be off"

        /** Android's resource IDs of the three attributes rule 6 reads (`android.R.attr`). */
        const val ALLOW_BACKUP_ID = 0x01010280
        const val BACKUP_AGENT_ID = 0x0101027f
        const val DATA_EXTRACTION_RULES_ID = 0x0101063e

        /** The two sections a rules file must have, and no other. */
        val RULES_SECTIONS = listOf("cloud-backup", "device-transfer")

        /** Every domain of the data extraction rules. Each section must exclude all of them. */
        val RULES_DOMAINS = listOf(
            "root", "file", "database", "sharedpref", "external",
            "device_root", "device_file", "device_database", "device_sharedpref",
        )

        /**
         * Rule 6: Android's own backup and device transfer are off, read from
         * the APK as it ships. [entries] returns a file of the APK by its
         * path, or null. In the compiled manifest's `<application>`:
         *
         * - `android:allowBackup` is the literal false. Android's default is
         *   true. On Android 12 and later it stops cloud backup only.
         * - `android:backupAgent` is not set.
         * - `android:dataExtractionRules` names an XML resource. Every
         *   configuration of it in `resources.arsc` (such as `xml` and
         *   `xml-v35`) is read: it has exactly one `<cloud-backup>` and one
         *   `<device-transfer>`, nothing else (so no opt-in
         *   `<cross-platform-transfer>`), and each excludes all
         *   [RULES_DOMAINS] with `path="."` and holds nothing but `<exclude>`.
         *
         * `fullBackupContent` is not read: Android uses it only on Android 11
         * and older, and the minimum is Android 13.
         */
        fun backupProblems(entries: (String) -> ByteArray?): List<String> {
            val manifest = ApkResourceReader.readXml(entries(APK_MANIFEST) ?: return listOf("no $APK_MANIFEST"))
            val application = manifest.children.singleOrNull { it.name == "application" }
                ?: return listOf("the manifest has no single <application>")
            val problems = mutableListOf<String>()
            val allowBackup = application.androidAttribute(ALLOW_BACKUP_ID, "allowBackup")
            when {
                allowBackup == null -> problems += "android:allowBackup is not set, and Android's default is true. It must be false"
                allowBackup.type != ApkResourceReader.TYPE_INT_BOOLEAN ->
                    problems += "android:allowBackup is not written as true or false (value type 0x%02x). It must be the literal false"
                        .format(allowBackup.type)
                allowBackup.data != 0 -> problems += "android:allowBackup is true. It must be false"
            }
            application.androidAttribute(BACKUP_AGENT_ID, "backupAgent")?.let {
                problems += "android:backupAgent is set (${it.text ?: "a resource"}). No app has a backup agent"
            }
            val rules = application.androidAttribute(DATA_EXTRACTION_RULES_ID, "dataExtractionRules")
            problems += when {
                rules == null -> listOf(
                    "android:dataExtractionRules is not set. On Android 12 and later only these rules turn device-to-device transfer off",
                )
                rules.type != ApkResourceReader.TYPE_REFERENCE && rules.type != ApkResourceReader.TYPE_DYNAMIC_REFERENCE ->
                    listOf("android:dataExtractionRules does not name an XML resource")
                else -> rulesFileProblems(rules.data, entries)
            }
            return problems
        }

        private fun rulesFileProblems(resourceId: Int, entries: (String) -> ByteArray?): List<String> {
            val table = entries(APK_RESOURCES) ?: return listOf("no $APK_RESOURCES, so android:dataExtractionRules cannot be read")
            val values = ApkResourceReader.resourceValues(table, resourceId)
            if (values.isEmpty()) {
                return listOf("android:dataExtractionRules names resource 0x%08x, which $APK_RESOURCES does not hold".format(resourceId))
            }
            return values.flatMap { value ->
                val path = value.string
                val bytes = path?.let(entries)
                when {
                    value.type != ApkResourceReader.TYPE_STRING || path == null ->
                        listOf("android:dataExtractionRules names @xml/${value.name}, which is not a file")
                    bytes == null -> listOf("android:dataExtractionRules names $path, which the APK does not hold")
                    else -> dataExtractionRulesProblems("the rules file $path (@xml/${value.name})", ApkResourceReader.readXml(bytes))
                }
            }
        }

        /** What is wrong with one rules file, empty if it turns everything off. [file] names it in the messages. */
        fun dataExtractionRulesProblems(file: String, root: ApkResourceReader.XmlElement): List<String> {
            if (root.name != "data-extraction-rules") return listOf("$file: the root is <${root.name}>, not <data-extraction-rules>")
            val problems = mutableListOf<String>()
            root.children.filter { it.name !in RULES_SECTIONS }.forEach { other ->
                problems += "$file: <${other.name}> is not allowed. Only <cloud-backup> and <device-transfer>, each excluding everything" +
                    if (other.name == "cross-platform-transfer") ". This section turns on a transfer to another platform" else ""
            }
            for (name in RULES_SECTIONS) {
                val sections = root.children.filter { it.name == name }
                if (sections.size != 1) {
                    problems += "$file: ${sections.size} <$name> sections. There must be exactly one"
                    continue
                }
                val section = sections.single()
                section.children.filter { it.name != "exclude" }.forEach { problems += "$file: <$name> holds <${it.name}>. It may only hold <exclude>" }
                val excluded = section.children
                    .filter { it.name == "exclude" && it.plainAttribute("path") == "." }
                    .mapNotNull { it.plainAttribute("domain") }
                    .toSet()
                RULES_DOMAINS.filter { it !in excluded }.forEach { problems += "$file: <$name> does not exclude the domain $it with path=\".\"" }
            }
            return problems
        }

        /** The compiled manifest and the resource table, by their paths in an APK. */
        const val APK_MANIFEST = "AndroidManifest.xml"
        const val APK_RESOURCES = "resources.arsc"

        const val WEBVIEW_RULE = "rule 7, hard rule 1: no WebView"
        const val LOADER_RULE = "rule 8, hard rule 1: no class loader that reads code"
        const val CALL_RULE = "rule 9, hard rule 1: no code loaded or run from a file path"

        /** Rule 7: the packages of WebView. Android's own, AndroidX WebKit and GeckoView. */
        val WEBVIEW_PACKAGES = listOf("android.webkit", "androidx.webkit", "org.mozilla.geckoview")

        /**
         * The two classes of `android.webkit` that rule 7 allows. They only turn
         * text into text and need no WebView: `MimeTypeMap` maps a file
         * extension to a MIME type, `URLUtil` reads parts of an address
         * (owner's decision in step 1.9).
         */
        val WEBVIEW_HELPERS = setOf("android.webkit.MimeTypeMap", "android.webkit.URLUtil")

        /** Rule 8: the classes that load code from a file, memory or the network, and their nested classes. */
        val CODE_LOADERS = setOf(
            "dalvik.system.DexClassLoader",
            "dalvik.system.PathClassLoader",
            "dalvik.system.InMemoryDexClassLoader",
            "dalvik.system.DelegateLastClassLoader",
            "dalvik.system.BaseDexClassLoader",
            "dalvik.system.DexFile",
            "java.net.URLClassLoader",
        )

        /**
         * Rule 9: methods that load native code from any file path, or run a
         * program. `loadLibrary` is not here: it loads only from the APK's own
         * library folder, which rule 2 keeps empty (owner's decision in step 1.9).
         */
        val CODE_CALLS = setOf(
            DexMethodReferences.MethodReference("Ljava/lang/System;", "load"),
            DexMethodReferences.MethodReference("Ljava/lang/Runtime;", "load"),
            DexMethodReferences.MethodReference("Ljava/lang/Runtime;", "exec"),
            DexMethodReferences.MethodReference("Ljava/lang/ProcessBuilder;", "start"),
        )

        /**
         * Rules 7, 8 and 9 for the bytes of one dex file:
         *
         * - Rule 7: no class of [WEBVIEW_PACKAGES] but [WEBVIEW_HELPERS].
         * - Rule 8: no class of [CODE_LOADERS].
         * - Rule 9: no reference to a method of [CODE_CALLS], read from the
         *   dex's table of method references.
         *
         * Rules 7 and 8 look for each name twice: as a class the dex names
         * (`Ldalvik/system/DexClassLoader;`), and as dotted text, the form
         * code uses to load a class by its name
         * (`Class.forName("dalvik.system.DexClassLoader")`). All these classes
         * belong to Android or Java and are never inside the APK, so R8
         * cannot rename them or fold them away.
         */
        fun shippedCodeProblems(dex: ByteArray): List<String> {
            val webView = WEBVIEW_PACKAGES.flatMap { namesUnder(it, dex) }
                .filter { (name, _) -> name.substringBefore('$') !in WEBVIEW_HELPERS }
                .map { (name, form) -> "$form $name ($WEBVIEW_RULE)" }
            val loaders = listOf("dalvik.system", "java.net").flatMap { namesUnder(it, dex) }
                .filter { (name, _) -> name.substringBefore('$') in CODE_LOADERS }
                .map { (name, form) -> "$form $name ($LOADER_RULE)" }
            val calls = DexMethodReferences.read(dex).filter { it in CODE_CALLS }.distinct().map { call ->
                val method = "${call.owner.removePrefix("L").removeSuffix(";").replace('/', '.')}.${call.name}"
                "a call to $method ($CALL_RULE). To find the calling class, a cloud session can run the SDK's " +
                    "dexdump -d on this dex file and search for \"${call.owner}.${call.name}:\""
            }
            return (webView + loaders).distinct() + calls
        }

        /** Every class of [packageName] in a dex file, as a class it names and as dotted text, with that form. */
        private fun namesUnder(packageName: String, dex: ByteArray): List<Pair<String, String>> =
            classesUnder("L" + packageName.replace('.', '/') + "/", dex).map { it to "class" } +
                dottedNamesUnder("$packageName.", dex).map { it to "the class name as text," }

        /**
         * The names that start with [prefix], in dotted form, in the bytes of
         * one dex file, sorted, each once. The byte before a match is not
         * looked at: in a dex file it is often the length of the string,
         * which can be any byte, a letter too. So a longer name such as
         * `com.example.android.webkit.X` also counts as `android.webkit.X`.
         * That would fail the build when it need not, but never pass it when
         * it must fail.
         */
        fun dottedNamesUnder(prefix: String, dex: ByteArray): List<String> {
            val pattern = prefix.toByteArray(Charsets.US_ASCII)
            val found = sortedSetOf<String>()
            var start = 0
            while (start <= dex.size - pattern.size) {
                if (pattern.indices.all { dex[start + it] == pattern[it] }) {
                    var end = start + pattern.size
                    while (end < dex.size && end - start < LONGEST_CLASS_NAME && isDottedNameByte(dex[end])) end++
                    if (end > start + pattern.size) found += String(dex, start, end - start, Charsets.US_ASCII)
                    start = end
                } else {
                    start++
                }
            }
            return found.toList()
        }

        /** True for a byte that can be part of a class name in dotted form. Only ASCII counts. */
        private fun isDottedNameByte(byte: Byte): Boolean {
            val char = byte.toInt().toChar()
            return char in 'a'..'z' || char in 'A'..'Z' || char in '0'..'9' || char == '.' || char == '$' || char == '_'
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
