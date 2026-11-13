package app.shkriuss.core.crypto

import com.google.crypto.tink.InsecureSecretKeyAccess
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.PrintStream
import java.io.PrintWriter
import java.io.StringWriter
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowLog

/**
 * No key, no recovery word and no plaintext ever appears in a log, an
 * error message or a `toString` (rule 4 of crypto-design.md, item 4 of
 * "What the tests must cover").
 *
 * The test runs every flow of the module, with its failures, and collects
 * everything that could be shown or logged: the text form of every object,
 * every exception with its stack trace and causes, Android's log, and the
 * standard output. Then it searches all of it for the secrets.
 */
@RunWith(RobolectricTestRunner::class)
class NoSecretsTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val recordId = "00112233-4455-4677-8899-aabbccddeeff"
    private val fileId = "0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff"
    private val plaintext = "PLAINTEXT-MARKER-7f3a-of-a-record-or-a-file"

    private val shown = mutableListOf<String>()

    private fun show(value: Any?) {
        shown += value.toString()
    }

    /** Runs [block], and keeps every way its failure could be shown. */
    private fun failing(block: () -> Unit) {
        try {
            block()
            throw AssertionError("expected a failure")
        } catch (failed: Exception) {
            val trace = StringWriter()
            failed.printStackTrace(PrintWriter(trace))
            shown += listOf(failed.toString(), failed.message.orEmpty(), failed.localizedMessage.orEmpty(), trace.toString())
            generateSequence(failed.cause) { it.cause }.forEach { shown += it.toString() }
        }
    }

    @Test
    fun noKeyNoWordAndNoPlaintextIsEverShownOrLogged() {
        ShadowLog.clear()
        val output = ByteArrayOutputStream()
        val standardOut = System.out
        val standardErr = System.err
        System.setOut(PrintStream(output, true))
        System.setErr(PrintStream(output, true))
        val secrets = try {
            runEveryFlow()
        } finally {
            System.setOut(standardOut)
            System.setErr(standardErr)
        }
        shown += output.toString()
        ShadowLog.getLogs().forEach { item -> shown += listOf(item.tag.orEmpty(), item.msg.orEmpty(), item.throwable.toString()) }

        assertTrue("the flows must have shown something to search", shown.size > 60)
        val everything = shown.joinToString("\n")
        secrets.forEach { (what, forms) ->
            forms.forEach { form ->
                assertTrue("$what appears in what the module shows or logs", !everything.contains(form, ignoreCase = true))
            }
        }
        // Each recovery word, as a whole word. None of the words of this key is a word the module uses.
        TestKeys.vectorRecoveryKey().words().toSet().forEach { word ->
            assertTrue("the recovery word at one position appears", !Regex("\\b$word\\b", RegexOption.IGNORE_CASE).containsMatchIn(everything))
        }
    }

    /** Every form in which a secret of bytes could turn up in text. */
    private fun forms(bytes: ByteArray): List<String> = listOf(
        bytes.toHex(),
        bytes.joinToString(" ") { "%02x".format(it) },
        bytes.joinToString(", "),
        bytes.joinToString(", ") { (it.toInt() and 0xff).toString() },
        Base64.getEncoder().encodeToString(bytes),
        Base64.getUrlEncoder().withoutPadding().encodeToString(bytes),
        String(bytes, Charsets.ISO_8859_1),
    )

    private fun runEveryFlow(): Map<String, List<String>> {
        val app = TestApp(temporary.newFolder())
        val crypto = app.open()
        val key = TestKeys.vectorRecoveryKey()
        val words = key.words()
        val derived = TestKeys.derived(key)
        val secrets = mutableMapOf(
            "the recovery key" to forms(ByteArray(32) { it.toByte() }),
            "the words" to listOf(words.joinToString(" "), words.joinToString(","), words.joinToString(", "), words.joinToString("")),
            "the plaintext" to listOf(plaintext) + forms(plaintext.toByteArray()),
        )
        listOf("record" to derived.record, "backup" to derived.backup, "file-key" to derived.fileKey).forEach { (name, keyset) ->
            secrets["the $name key"] = TestKeys.keyBytes(keyset).flatMap { forms(hex(it)) }
            secrets["the $name keyset"] = forms(KeysetCodec.serialize(keyset))
            show(keyset)
        }

        // The recovery key and its words.
        show(key)
        show(derived)
        show(RecoveryWords.parse(words.joinToString(" ")))
        show(RecoveryWords.parse(words.dropLast(1).joinToString(" ")))
        show(RecoveryWords.parse(words.joinToString(" ").replace(words[3], "notaword")))
        show(RecoveryWords.parse(words.reversed().joinToString(" ")))
        show(TestKeys.recoveryKeyset(key))
        show(crypto.setup.createRecoveryKey())

        // Setup, keeping and showing.
        show(crypto.setup.storeDerivedKeys(key))
        show(crypto.status())
        val keep = crypto.setup.beginKeepRecoveryKey(key)!!
        show(keep)
        show(keep.cryptoObject)
        keep.finish()
        val showAgain = app.open().setup.beginShowRecoveryKey()
        show(showAgain)
        show(showAgain.finish())
        failing { showAgain.finish() }
        show(crypto.setup.storeDerivedKeys(RecoveryKey.ofBytes(ByteArray(32) { 0x77 })))

        // Records.
        show(crypto.records)
        val sealed = crypto.records.seal(recordId, plaintext.toByteArray())
        show(String(crypto.records.open(recordId, sealed)).length)
        failing { crypto.records.open(recordId, sealed.copyOf().also { it[40] = (it[40] + 1).toByte() }) }
        failing { crypto.records.open(fileId, sealed) }
        failing { crypto.records.open(recordId, sealed.copyOf(30)) }
        failing { crypto.records.open(recordId, sealed.copyOf().also { it[7] = (it[7] + 1).toByte() }) }
        failing { crypto.records.open(recordId, sealed.copyOf().also { it[3] = 9 }) }
        failing { crypto.records.open(recordId, plaintext.toByteArray()) }
        failing { crypto.records.seal("not an id", plaintext.toByteArray()) }

        // Files and file keys.
        val fileKey = crypto.files.newFileKey()
        secrets["the file key"] = forms(KeysetCodec.serialize(fileKey.keyset)) + TestKeys.keyBytes(fileKey.keyset).flatMap { forms(hex(it)) }
        show(fileKey)
        show(fileKey.keyset)
        show(crypto.files)
        val file = TestKeys.encryptFile(fileKey, fileId, plaintext.toByteArray())
        val wrapped = crypto.files.wrap(fileId, fileKey)
        show(crypto.files.unwrap(fileId, wrapped))
        show(TestKeys.decryptFile(fileKey, fileId, file).size)
        failing { TestKeys.decryptFile(fileKey, recordId, file) }
        failing { TestKeys.decryptFile(fileKey, fileId, file.copyOf(file.size - 17)) }
        failing { TestKeys.decryptFile(crypto.files.newFileKey(), fileId, file) }
        failing { crypto.files.unwrap(recordId, wrapped) }
        failing { crypto.files.unwrap(fileId, sealed) }

        // Backups.
        val header = "a backup header".toByteArray()
        val backup = ByteArrayOutputStream()
        crypto.backups.encryptingStream(header, backup).use { it.write(plaintext.toByteArray()) }
        show(crypto.backups)
        show(crypto.backups.keyId())
        show(crypto.backups.decryptingStream(header, ByteArrayInputStream(backup.toByteArray())).use { it.readBytes() }.size)
        failing { crypto.backups.decryptingStream("another header".toByteArray(), ByteArrayInputStream(backup.toByteArray())).readBytes() }

        // The app lock, and the checks of the words before it.
        val proof = crypto.setup.checkAllWords(key)!!
        show(proof)
        show(crypto.setup.checkFourWords(key, mapOf(1 to words[0], 7 to words[6], 13 to words[12], 24 to "notaword")))
        show(crypto.setup.checkAllWords(RecoveryKey.ofBytes(ByteArray(32) { 0x77 })))
        val turnOn = crypto.appLock.beginTurnOn(proof)
        show(turnOn)
        turnOn.finish()
        show(crypto.appLock.state())
        show(crypto.status())
        show(crypto.status().hardwareKeys)
        val locked = app.open()
        failing { locked.files.unwrap(fileId, wrapped) }
        failing { locked.appLock.turnOff() }
        failing { locked.appLock.beginTurnOn(WordsProof()) }
        val unlock = locked.appLock.beginUnlock()
        show(unlock)
        unlock.finish()
        show(locked.files.unwrap(fileId, wrapped))
        locked.appLock.turnOff()

        // What the vault holds, and failures of the hardware keys.
        show(app.vault)
        KeysetName.entries.forEach { name ->
            val stored = app.vault.look(name)
            show(stored)
            if (stored is Stored.Open) show(stored.keyset)
        }
        show(app.vault.fileKeysets(create = false))
        File(app.folder, "record").let { it.writeBytes(it.readBytes().also { bytes -> bytes[bytes.size - 2] = 0 }) }
        failing { app.open().records.seal(recordId, plaintext.toByteArray()) }
        // The words repair the damaged file. What it says, and the refusals around it.
        show(app.open().setup.storeDerivedKeys(key))
        show(app.open().setup.startOver(key))
        failing { app.open().setup.giveUpDamagedFileKeys() }
        failing { app.open().setup.beginKeepRecoveryKey(RecoveryKey.newRandom()) }
        failing { TestApp(temporary.newFolder()).open().setup.finishFileKeyMove() }
        app.hardware.keystoreFails = true
        failing { app.open().backups.keyId() }
        failing { app.vault.newKey(HardwareKeyKind.LOCK) }
        app.hardware.keystoreFails = false
        app.hardware.cannotMake = true
        failing { TestApp(temporary.newFolder(), app.hardware).open().setup.storeDerivedKeys(key) }
        failing { KeysetCodec.parse(KeysetCodec.serialize(derived.record), KeysetType.STREAMING) }
        failing { RecoveryKeyDeriver.derive(TestKeys.recoveryKeyset(key), AppName.of("sync")) }
        failing { RecoveryKey.ofBytes(ByteArray(16) { it.toByte() }) }

        // The raw key of the recovery key, read the way the module reads it.
        show(key.prfKey)
        show(key.prfKey.parameters)
        show(key.prfKey.keyBytes)
        show(key.prfKey.keyBytes.toByteArray(InsecureSecretKeyAccess.get()).size)
        return secrets
    }

    @Test
    fun theModuleNeverLogsOrPrints() {
        val sources = File("src/main/kotlin").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        assertTrue("the test must read this module's sources, and found ${sources.size}", sources.size >= 20)
        val forbidden = listOf(
            "android.util.Log",
            "Log.",
            "println",
            "print(",
            "printStackTrace",
            "System.out",
            "System.err",
            "java.util.logging",
            "Logger",
            "Timber",
        )
        val found = sources.flatMap { file -> forbidden.filter { it in file.readText() }.map { "${file.name}: $it" } }
        assertEquals("core/crypto never logs", emptyList<String>(), found)
    }

    @Test
    fun onlyClassesWithoutSecretsAreDataClasses() {
        // A data class writes its fields into its toString. Nothing that holds a key may be one.
        val sources = File("src/main/kotlin").walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        val dataClasses = sources.flatMap { Regex("""data class (\w+)""").findAll(it.readText()).map { match -> match.groupValues[1] } }
        assertEquals(listOf("HardwareKeyRef"), dataClasses)
        assertEquals("HardwareKeyRef(kind=LOCK, number=3)", HardwareKeyRef(HardwareKeyKind.LOCK, 3).toString())
    }

    @Test
    fun theTextFormOfEveryClassThatHoldsASecretIsFixed() {
        val key = TestKeys.vectorRecoveryKey()
        assertEquals("RecoveryKey", key.toString())
        assertEquals("FileKey", FileKey(KeysetCodec.newRandom(KeysetType.STREAMING)).toString())
        assertEquals("DerivedKeysets", TestKeys.derived(key).toString())
        assertEquals("Accepted", RecoveryWords.parse(key.words().joinToString(" ")).toString())
        assertEquals("WordNotInList(1)", RecoveryWords.parse("nope").toString())
        assertEquals("DoNotBelongTogether", RecoveryWords.parse("abandon").toString())
        assertEquals("WordsProof", WordsProof().toString())
    }
}
