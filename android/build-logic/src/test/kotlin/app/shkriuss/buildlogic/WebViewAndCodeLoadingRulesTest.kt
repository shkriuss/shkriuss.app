package app.shkriuss.buildlogic

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * Shows that rules 7, 8 and 9 of the APK rules check
 * ([CheckApkRulesTask.shippedCodeProblems]) fail on a dex file that names a
 * WebView class, a class loader that reads code, or a call that loads or
 * runs code from a file path, and pass on one that does not.
 *
 * The forbidden names are written out here, not taken from the check, so a
 * shorter list in the check fails a test.
 */
class WebViewAndCodeLoadingRulesTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val webViewClasses = listOf(
        "android.webkit.WebView",
        "android.webkit.WebViewClient",
        "android.webkit.WebChromeClient",
        "android.webkit.WebSettings",
        "android.webkit.CookieManager",
        "android.webkit.JavascriptInterface",
        "android.webkit.ValueCallback",
        "androidx.webkit.WebViewCompat",
        "org.mozilla.geckoview.GeckoView",
    )

    private val codeLoaders = listOf(
        "dalvik.system.DexClassLoader",
        "dalvik.system.PathClassLoader",
        "dalvik.system.InMemoryDexClassLoader",
        "dalvik.system.DelegateLastClassLoader",
        "dalvik.system.BaseDexClassLoader",
        "dalvik.system.DexFile",
        "java.net.URLClassLoader",
    )

    private val codeCalls = listOf(
        "Ljava/lang/System;" to "load",
        "Ljava/lang/Runtime;" to "load",
        "Ljava/lang/Runtime;" to "exec",
        "Ljava/lang/ProcessBuilder;" to "start",
    )

    /** What today's release APK of Catalog holds in these packages and calls, and more that is allowed. */
    private val clean = DexWriter.dex(
        types = listOf(
            "Ljava/lang/Object;", "Landroid/app/Activity;", "Ljava/lang/ClassLoader;",
            "Landroid/webkit/MimeTypeMap;", "Landroid/webkit/URLUtil;", "Ldalvik/system/ZipPathValidator\$Callback;",
        ),
        methods = listOf(
            "Ljava/lang/System;" to "loadLibrary",
            "Ljava/lang/Runtime;" to "loadLibrary",
            "Ljava/lang/Runtime;" to "getRuntime",
            "Ljava/lang/ClassLoader;" to "loadClass",
            "Landroid/webkit/MimeTypeMap;" to "getSingleton",
        ),
        texts = listOf("android.webkit.MimeTypeMap", "dalvik.system.ZipPathValidator", "com.example.PluginLoader", "exec", "load"),
    )

    private fun descriptor(name: String) = "L" + name.replace('.', '/') + ";"

    private fun problems(dex: ByteArray) = CheckApkRulesTask.shippedCodeProblems(dex)

    @Test
    fun aCleanDexPasses() = assertEquals(emptyList<String>(), problems(clean))

    @Test
    fun theCheckKnowsEveryNameAndCall() {
        assertEquals(codeLoaders.toSet(), CheckApkRulesTask.CODE_LOADERS)
        assertEquals(setOf("android.webkit.MimeTypeMap", "android.webkit.URLUtil"), CheckApkRulesTask.WEBVIEW_HELPERS)
        assertEquals(codeCalls.map { (owner, name) -> DexMethodReferences.MethodReference(owner, name) }.toSet(), CheckApkRulesTask.CODE_CALLS)
    }

    @Test
    fun aWebViewClassFailsAsAClassAndAsText() {
        webViewClasses.forEach { name ->
            assertEquals(listOf("class $name (rule 7, hard rule 1: no WebView)"), problems(DexWriter.dex(types = listOf(descriptor(name)))))
            assertEquals(
                listOf("the class name as text, $name (rule 7, hard rule 1: no WebView)"),
                problems(DexWriter.dex(texts = listOf(name))),
            )
        }
    }

    @Test
    fun aClassLoaderFailsAsAClassAsTextAndAsASuperclassOfANestedClass() {
        codeLoaders.forEach { name ->
            assertEquals(listOf("class $name (rule 8, hard rule 1: no class loader that reads code)"), problems(DexWriter.dex(types = listOf(descriptor(name)))))
            assertEquals(
                listOf("the class name as text, $name (rule 8, hard rule 1: no class loader that reads code)"),
                problems(DexWriter.dex(texts = listOf("$name"))),
            )
            assertEquals(1, problems(DexWriter.dex(types = listOf(descriptor("$name\$Inner")))).size)
        }
    }

    @Test
    fun aCallThatLoadsOrRunsCodeFails() {
        codeCalls.forEach { (owner, name) ->
            val problems = problems(DexWriter.dex(methods = listOf(owner to name)))
            val method = owner.removePrefix("L").removeSuffix(";").replace('/', '.') + "." + name
            assertEquals(problems.toString(), 1, problems.size)
            assertTrue(problems.single(), problems.single().startsWith("a call to $method (rule 9"))
            assertTrue(problems.single(), "dexdump -d" in problems.single())
        }
    }

    @Test
    fun theMethodTableIsReadAsWritten() {
        val references = DexMethodReferences.read(DexWriter.dex(methods = listOf("Ljava/lang/Runtime;" to "exec", "Lapp/A;" to "run")))
        assertEquals(
            listOf(DexMethodReferences.MethodReference("Ljava/lang/Runtime;", "exec"), DexMethodReferences.MethodReference("Lapp/A;", "run")),
            references,
        )
    }

    @Test
    fun aDexFileThatCannotBeReadIsRefused() {
        listOf(DexWriter.dex(version = "041"), "not a dex file at all, not even close to one, really not".toByteArray(), ByteArray(0x70))
            .forEach { bytes ->
                val refused = try {
                    DexMethodReferences.read(bytes)
                    false
                } catch (expected: RuntimeException) {
                    true
                }
                assertTrue(refused)
            }
    }

    private fun apk(vararg dexFiles: Pair<String, ByteArray>): File {
        val file = temporary.newFolder().resolve("app-release-unsigned.apk")
        ZipOutputStream(file.outputStream()).use { zip ->
            dexFiles.forEach { (name, bytes) ->
                zip.putNextEntry(ZipEntry(name))
                zip.write(bytes)
                zip.closeEntry()
            }
        }
        return file
    }

    @Test
    fun everyDexFileOfAnApkIsRead() {
        val apk = apk("classes.dex" to clean, "classes2.dex" to DexWriter.dex(types = listOf("Landroid/webkit/WebView;"), methods = listOf("Ljava/lang/Runtime;" to "exec")))
        val problems = CheckApkRulesTask.apkShippedCodeProblems(apk)
        assertEquals(2, problems.size)
        assertTrue(problems.all { it.endsWith("in classes2.dex of app-release-unsigned.apk") })
        assertEquals(emptyList<String>(), CheckApkRulesTask.apkShippedCodeProblems(apk("classes.dex" to clean)))
    }

    @Test
    fun anApkWithoutDexOrWithAnUnreadableDexFails() {
        assertTrue(CheckApkRulesTask.apkShippedCodeProblems(apk()).single().startsWith("no dex file"))
        assertTrue(CheckApkRulesTask.apkShippedCodeProblems(apk("classes.dex" to DexWriter.dex(version = "041"))).single().contains("cannot be read"))
    }
}
