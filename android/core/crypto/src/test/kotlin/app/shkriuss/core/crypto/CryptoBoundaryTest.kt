package app.shkriuss.core.crypto

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * No module but `core/crypto` uses Tink, `javax.crypto`,
 * `java.security.KeyStore` or `android.security.keystore` (rule 2 of
 * crypto-design.md, item 8 of "What the tests must cover").
 *
 * The test reads the source of every other module under `android/`. It
 * reads the whole text of each file, so a name that is written out in full
 * without an import is caught too. A comment that names one of them fails
 * as well: word it differently.
 *
 * Tink is also an `implementation` dependency of this module, so other
 * modules cannot compile against it at all.
 */
class CryptoBoundaryTest {
    /** The folder `android/`, found from wherever Gradle runs the test. */
    private val androidFolder: File = generateSequence(File("").absoluteFile) { it.parentFile }
        .first { File(it, "settings.gradle.kts").isFile && File(it, "build-logic").isDirectory }

    private val thisModule = File(androidFolder, "core/crypto")

    private fun sourcesIn(folder: File): List<File> = folder.walkTopDown()
        .onEnter { it.name !in SKIPPED_FOLDERS }
        .filter { it.isFile && it.extension in SOURCE_ENDINGS }
        .toList()

    @Test
    fun noOtherModuleUsesCryptography() {
        val sources = sourcesIn(androidFolder).filterNot { it.startsWith(thisModule) }
        assertTrue("the test must read the other modules, and found only ${sources.size} files", sources.size >= 50)
        listOf("core/data", "core/design", "core/testing", "app/catalog", "build-logic").forEach { module ->
            assertTrue("no source of $module was read", sources.any { it.startsWith(File(androidFolder, module)) })
        }

        val problems = sources.flatMap { file ->
            problemsIn(file.readText()).map { "${file.relativeTo(androidFolder).invariantSeparatorsPath}: $it" }
        }

        assertEquals(
            "Cryptography only through core/crypto (CLAUDE.md, crypto-design.md rule 2). " +
                "Use what core/crypto offers, or stop and ask the owner.",
            emptyList<String>(),
            problems,
        )
    }

    @Test
    fun thisModuleItselfWouldNotPass() {
        // The check is not blind: the one module that may use all of this trips every rule but the star import.
        val found = sourcesIn(File(thisModule, "src/main")).flatMap { problemsIn(it.readText()) }.toSet()
        assertEquals(
            setOf(
                "names com.google.crypto.tink",
                "names javax.crypto",
                "names java.security.KeyStore",
                "names android.security.keystore",
            ),
            found,
        )
        assertEquals(
            listOf("uses the Tink entry of the version catalog"),
            problemsIn(File(thisModule, "build.gradle.kts").readText()),
        )
    }

    @Test
    fun whatTheCheckFinds() {
        val forbidden = mapOf(
            "import com.google.crypto.tink.Aead" to "names com.google.crypto.tink",
            "import com.google.crypto.tink.subtle.Hkdf" to "names com.google.crypto.tink",
            "import javax.crypto.Cipher" to "names javax.crypto",
            "import javax.crypto.spec.GCMParameterSpec" to "names javax.crypto",
            "import javax.crypto.*" to "names javax.crypto",
            "val mac = javax.crypto.Mac.getInstance(\"HmacSHA256\")" to "names javax.crypto",
            "import java.security.KeyStore" to "names java.security.KeyStore",
            "import java.security.KeyStore as Store" to "names java.security.KeyStore",
            "import java.security.KeyStoreException" to "names java.security.KeyStore",
            "java.security.KeyStore.getInstance(\"AndroidKeyStore\")" to "names java.security.KeyStore",
            "import android.security.keystore.KeyGenParameterSpec" to "names android.security.keystore",
            "import java.security.*" to "imports java.security.* with a star",
            "import  java.security.*  // everything" to "imports java.security.* with a star",
            "val cipher = step.cryptoObject.cipher" to "takes the cipher out of a CryptoObject",
            "step.cryptoObject.getCipher().doFinal(bytes)" to "takes the cipher out of a CryptoObject",
            "implementation(libs.tink.android)" to "uses the Tink entry of the version catalog",
            "implementation(\"com.google.crypto.tink:tink-android:1.24.0\")" to "names com.google.crypto.tink",
        )
        forbidden.forEach { (line, problem) -> assertEquals(line, listOf(problem), problemsIn("package a\n\n$line\n")) }

        val allowed = listOf(
            "import java.security.MessageDigest",
            "import java.security.SecureRandom",
            "import java.util.UUID",
            "import app.shkriuss.core.crypto.ShkCrypto",
            "import android.hardware.biometrics.BiometricPrompt",
            "prompt.authenticate(step.cryptoObject, cancel, executor, callback)",
            "val result = step.finish()",
            "val decipher = 1",
        )
        allowed.forEach { line -> assertEquals(line, emptyList<String>(), problemsIn("package a\n\n$line\n")) }
    }

    /** What is wrong with one source file, as a list of short sentences. Empty if nothing is. */
    private fun problemsIn(text: String): List<String> = buildList {
        NAMES.forEach { name -> if (name in text) add("names $name") }
        if (STAR_IMPORT.containsMatchIn(text)) add("imports java.security.* with a star")
        if (CIPHER_OF_A_CRYPTO_OBJECT.containsMatchIn(text)) add("takes the cipher out of a CryptoObject")
        if (CATALOG_ENTRY in text) add("uses the Tink entry of the version catalog")
    }

    private companion object {
        val SOURCE_ENDINGS = setOf("kt", "kts", "java")
        val SKIPPED_FOLDERS = setOf("build", ".gradle", ".kotlin", ".git")

        val NAMES = listOf(
            "com.google.crypto.tink",
            "javax.crypto",
            "java.security.KeyStore",
            "android.security.keystore",
        )

        /** With a star import, `KeyStore` could be used without its full name anywhere in the file. */
        val STAR_IMPORT = Regex("""import\s+java\.security\.\*""")

        /** The screen code hands the prompt a `CryptoObject` and never touches the cipher inside. */
        val CIPHER_OF_A_CRYPTO_OBJECT = Regex("""\.cipher\b|\.getCipher\s*\(""")

        const val CATALOG_ENTRY = "libs.tink"
    }
}
