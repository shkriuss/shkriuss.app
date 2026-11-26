package app.shkriuss.notes

import android.app.Activity
import android.app.Application
import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.net.Uri
import android.provider.Settings
import androidx.annotation.StringRes
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.performSemanticsAction
import androidx.room3.executeSQL
import androidx.room3.useWriterConnection
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.shkriuss.core.backup.BackupContent
import app.shkriuss.core.backup.BackupRecord
import app.shkriuss.core.backup.BackupSink
import app.shkriuss.core.backup.Backups
import app.shkriuss.core.backup.CheckedBackup
import app.shkriuss.core.backup.ExportResult
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.RecoveryWords
import app.shkriuss.core.crypto.RecoveryWordsResult
import app.shkriuss.core.crypto.ShkCrypto
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.security.SecurityHost
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.feature.notes.BackupStep
import app.shkriuss.feature.notes.Note
import app.shkriuss.feature.notes.NotesServices
import app.shkriuss.feature.notes.NoteFile
import app.shkriuss.feature.notes.NotesRepository
import app.shkriuss.feature.notes.PickedFile
import app.shkriuss.feature.notes.Saved
import app.shkriuss.feature.notes.data.NoteEntity
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf

/** The app class of the test. */
val testApp: NotesTestApp
    get() = ApplicationProvider.getApplicationContext<Application>() as NotesTestApp

/** The words of string [id] of the app, with [args]. */
fun words(@StringRes id: Int, vararg args: Any): String =
    ApplicationProvider.getApplicationContext<Application>().getString(id, *args)

/** Writes what a test starts with, before the screen starts, as the user would have. */
fun <T> seed(write: suspend NotesRepository.() -> T): T = runBlocking { testApp.test.services.repository.write() }

/** Writes a note as typing would have, at the test's clock, and gives its `id`. */
suspend fun NotesRepository.addNote(title: String, body: String = ""): String {
    val id = reserveNoteId()
    check(save(id, title, body) == Saved.WRITTEN)
    return id
}

/** Moves the test's clock to [millis] since 1970 UTC, so the next write is made then. */
fun clockAt(millis: Long) {
    testApp.test.clock.nowMillis = millis
}

/** The notes that are not deleted, as the database holds them now. */
fun storedNotes(): List<Note> = runBlocking { testApp.test.services.repository.notes().first() }

/** Every note as the database holds it now, deleted ones too. */
fun everyNote(): List<NoteEntity> = runBlocking { testApp.test.database.notes().all() }

/** The files that are not deleted, as the database holds them now. */
fun storedFiles(): List<NoteFile> = runBlocking { testApp.test.services.repository.shownFiles().first() }

/** Every write to the table of notes fails from now on, as on a disk that refuses. */
fun refuseWrites() = runBlocking {
    testApp.test.database.useWriterConnection {
        it.executeSQL("CREATE TRIGGER refuse BEFORE UPDATE ON ${NoteEntity.TABLE} BEGIN SELECT RAISE(ABORT, 'refused'); END")
    }
}

/** The phone's "Use 24-hour format", as in the spec's examples: "14:05". */
fun use24HourClock() {
    Settings.System.putString(ApplicationProvider.getApplicationContext<Application>().contentResolver, Settings.System.TIME_12_24, "24")
}

/** A file the picker gives: [bytes] under [name] and [type]. With [hold], a read waits until the test lets it go on. */
class BytesPick(
    private val name: String,
    private val type: String,
    private val bytes: ByteArray,
    private val hold: java.util.concurrent.CountDownLatch? = null,
) : PickedFile {
    override fun name(): String = name

    override fun type(): String = type

    override fun reportedSize(): Long = bytes.size.toLong()

    override fun open(): InputStream = object : InputStream() {
        private var at = 0

        override fun read(): Int {
            val one = ByteArray(1)
            return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and BYTE
        }

        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (at >= bytes.size) return -1
            // Half the file comes at once, then the read waits: a row being added shows its bar part of the way.
            val half = bytes.size / 2
            if (hold != null && at >= half) hold.await()
            val end = if (hold != null && at < half) half else bytes.size
            val count = minOf(length, end - at)
            System.arraycopy(bytes, at, buffer, offset, count)
            at += count
            return count
        }
    }
}

/** A small picture, as a PNG file: a blue sky over a green hill, [width] by [height] pixels. */
fun pngBytes(width: Int = 120, height: Int = 80): ByteArray {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    Canvas(bitmap).apply {
        drawColor(Color.rgb(0x7E, 0xC8, 0xE3))
        drawCircle(width * 0.3f, height * 1.3f, height * 0.8f, Paint().apply { color = Color.rgb(0x4C, 0xAF, 0x50) })
    }
    return ByteArrayOutputStream().use { out ->
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        out.toByteArray()
    }
}

/**
 * Adds [picks] to the note [noteId] as **Add a file** does, through the
 * adds of the app's services, and waits until every one is stored. The
 * screen must be on: adds start only then.
 */
fun ComposeTestRule.addFiles(noteId: String, vararg picks: PickedFile) {
    val before = storedFiles().size
    testApp.test.services.adds.add(noteId, picks.toList())
    waitUntil(WAIT_MILLIS) { storedFiles().size == before + picks.size }
    waitForIdle()
}

/** Waits up to five seconds, for the database and the files, until something matches [matcher]. */
fun ComposeTestRule.waitFor(matcher: SemanticsMatcher, useUnmergedTree: Boolean = false) {
    waitUntil(WAIT_MILLIS) { onAllNodes(matcher, useUnmergedTree).fetchSemanticsNodes().isNotEmpty() }
}

/** Waits until nothing matches [matcher] any more. */
fun ComposeTestRule.waitForGone(matcher: SemanticsMatcher) {
    waitUntil(WAIT_MILLIS) { onAllNodes(matcher).fetchSemanticsNodes().isEmpty() }
}

/** Waits until something shows [text]. */
fun ComposeTestRule.waitForText(text: String, substring: Boolean = false) = waitFor(hasText(text, substring = substring))

/** A field whose error, which TalkBack announces, is [text]. */
fun hasError(text: String): SemanticsMatcher = SemanticsMatcher.expectValue(SemanticsProperties.Error, text)

/** What can be typed in: a text field or a text editor. */
val IS_EDITABLE: SemanticsMatcher = SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText)

/**
 * Taps the one thing that can be tapped and shows [text], or is labelled
 * [text] for TalkBack, as an icon button is, as TalkBack does: also below
 * the edge of the window, and without a ripple. It waits for it first.
 */
fun ComposeTestRule.tap(text: String, substring: Boolean = false) =
    tap(hasText(text, substring = substring) or hasContentDescription(text, substring = substring))

/** Taps the one thing that can be tapped with the words of string [id]. */
fun ComposeTestRule.tap(@StringRes id: Int) = tap(words(id))

/** Taps the one thing that can be tapped and matches [matcher], once it shows. */
fun ComposeTestRule.tap(matcher: SemanticsMatcher) {
    val target = matcher and hasClickAction() and !IS_EDITABLE
    waitFor(target)
    onNode(target).tapAsTalkBack()
    waitForIdle()
}

/** A tap as TalkBack makes it. */
fun SemanticsNodeInteraction.tapAsTalkBack(): SemanticsNodeInteraction = performSemanticsAction(SemanticsActions.OnClick)

/** The row of the note or file whose spoken words start with [start], as TalkBack finds it: one item that can be tapped. */
fun ComposeTestRule.row(start: String): SemanticsNodeInteraction = onNode(rowMatcher(start))

/** What [row] finds. */
fun rowMatcher(start: String): SemanticsMatcher =
    SemanticsMatcher("TalkBack reads \"$start…\"") { node ->
        node.config.getOrElse(SemanticsProperties.ContentDescription) { emptyList() }.any { it.startsWith(start) }
    } and hasClickAction()

/** Runs the TalkBack action [label] of the one item that [matcher] finds. */
fun ComposeTestRule.runAction(matcher: SemanticsMatcher, label: String) {
    waitFor(matcher)
    val actions = onNode(matcher).fetchSemanticsNode().config[SemanticsActions.CustomActions]
    check(actions.any { it.label == label }) { "It offers ${actions.map { it.label }}, not $label" }
    runOnUiThread { actions.single { it.label == label }.action() }
    waitForIdle()
}

/** The text editor whose text is [text], or whose hint is [text] while it is empty. */
fun ComposeTestRule.editor(text: String): SemanticsNodeInteraction =
    onNode(IS_EDITABLE and (hasText(text) or SemanticsMatcher.expectValue(SemanticsProperties.EditableText, androidx.compose.ui.text.AnnotatedString(text))))

/**
 * Sets up the documents of the test's file picker, as files in a new
 * folder of the test app (`TestDocuments` of core/testing). Robolectric
 * shows no picker: a test hands the screen documents with
 * [theOpenedScreenCloses].
 */
fun pickerDocuments() {
    val app = ApplicationProvider.getApplicationContext<Application>()
    TestDocuments.folder = File(app.cacheDir, "picker-documents").apply {
        deleteRecursively()
        mkdirs()
    }
    TestDocuments.onOpen = {}
    Robolectric.setupContentProvider(TestDocuments::class.java, TestDocuments.AUTHORITY)
}

/** The screen of Android that Notes opened for a result and that still waits, or null. */
fun ActivityScenario<NotesActivity>.openedForResult(): Intent? {
    var opened: Intent? = null
    onActivity { opened = shadowOf(it).peekNextStartedActivityForResult()?.intent }
    return opened
}

/** Waits until Notes has opened a screen for a result that [matches], and gives its intent. */
fun ComposeTestRule.waitForOpened(scenario: ActivityScenario<NotesActivity>, matches: (Intent) -> Boolean): Intent {
    waitUntil(WAIT_MILLIS) { scenario.openedForResult()?.let(matches) == true }
    return checkNotNull(scenario.openedForResult())
}

/**
 * The file picker Notes opened closes. With [picked], the user picked
 * those documents, one in the data and more in the clip, as Android gives
 * them. With none, the user left it.
 */
fun ComposeTestRule.theOpenedScreenCloses(scenario: ActivityScenario<NotesActivity>, vararg picked: Uri) {
    scenario.onActivity { activity ->
        val opened = shadowOf(activity).nextStartedActivityForResult
        val data = when (picked.size) {
            0 -> null
            1 -> Intent().setData(picked.single())
            else -> Intent().apply {
                clipData = ClipData.newRawUri(null, picked.first()).also { clip -> picked.drop(1).forEach { clip.addItem(ClipData.Item(it)) } }
            }
        }
        shadowOf(activity).receiveResult(opened.intent, if (data != null) Activity.RESULT_OK else Activity.RESULT_CANCELED, data)
    }
    waitForIdle()
}

/**
 * Waits until Settings shows all of its sections. Backup and Security come
 * once the keys were read, on a thread Compose does not wait for, so a
 * screenshot waits for them: otherwise it could be taken without them.
 */
fun ComposeTestRule.waitForSettings() {
    waitForText(words(app.shkriuss.feature.notes.R.string.notes_version))
    waitForText(words(app.shkriuss.feature.notes.R.string.notes_make_backup))
}

/** The backup file of the tests, as Notes suggests its name on the day of [THE_TIME]. */
const val BACKUP_NAME = "notes-2026-11-24.shkbackup"

/** The app of the test gets its keys from a new recovery key, as the create flow of core/security stores them. */
fun giveTheAppARecoveryKey() {
    val crypto = (ApplicationProvider.getApplicationContext<Application>() as SecurityHost).crypto
    crypto.setup.storeDerivedKeys(crypto.setup.createRecoveryKey())
}

/** Writes a backup of what the test's app holds now into the document [name], past the screens, and checks it. */
fun writeABackup(name: String = BACKUP_NAME): Uri {
    val document = TestDocuments.uri(name)
    val ended = runBlocking { testApp.test.services.backups.write(document) {} }
    check(ended is BackupStep.Written) { "The backup of the test was not written: $ended" }
    return document
}

/**
 * Writes a backup of [content] into the document [name], with the backup
 * keys of [crypto] and the app name [appName], past the screens: as
 * another app, other recovery words or a newer version of Notes would
 * write it.
 */
fun writeABackupOf(
    content: BackupContent,
    crypto: ShkCrypto = (ApplicationProvider.getApplicationContext<Application>() as SecurityHost).crypto,
    appName: AppName = NotesServices.APP_NAME,
    name: String = BACKUP_NAME,
): Uri {
    val app = ApplicationProvider.getApplicationContext<Application>()
    val document = TestDocuments.uri(name)
    val staging = File(app.cacheDir, "staging-of-another-writer").apply { mkdirs() }
    val written = runBlocking {
        Backups(app.contentResolver, crypto.backups, appName, content, staging, testApp.test.clock, Dispatchers.Unconfined).export(document)
    }
    check(written is ExportResult.Written) { "The backup of the test was not written: $written" }
    return document
}

/** What a backup of another writer holds: [records], with the data version [dataVersion]. It is only written, never restored. */
class OtherContent(override val dataVersion: Int, private val records: List<BackupRecord> = emptyList()) : BackupContent {
    override suspend fun list(into: BackupSink) = records.forEach { into.record(it) }

    override suspend fun restore(from: CheckedBackup) = error("Only written, never restored")
}

/** One record of the type [type], which Notes does not know, not deleted. */
fun otherRecord(type: String): BackupRecord =
    BackupRecord(type, RecordFields("00000000-0000-4000-8000-000000abc001", 1_000, 2_000, null), ByteArray(4))

/**
 * The keys of a second app named [appName], with its keyset files in a
 * folder of its own, from recovery words that are not those of the test's
 * app. The words are fixed, so the short name of their key is the same in
 * every run, and a screenshot that shows it stays the same.
 */
fun keysOfOtherWords(appName: AppName): ShkCrypto {
    val app = ApplicationProvider.getApplicationContext<Application>()
    val folder = File(app.cacheDir, "keys-of-other-words-$appName").apply { deleteRecursively() }
    val other = SoftwareKeysApp(folder, appName)
    other.crypto.setup.storeDerivedKeys((RecoveryWords.parse(OTHER_WORDS) as RecoveryWordsResult.Accepted).recoveryKey)
    return other.crypto
}

/** 24 recovery words: the BIP-39 words of 32 zero bytes. */
private val OTHER_WORDS = (List(23) { "abandon" } + "art").joinToString(" ")

/**
 * Changes the last byte of the wrapped key of the file [id], past the
 * app, as damage on the disk would: the key can no longer be opened, so
 * it can no longer move to the recovery key.
 */
fun damageTheKeyOf(id: String) = runBlocking {
    val database = testApp.test.database
    val key = checkNotNull(database.attachments().find(id)).wrappedKey
    key[key.size - 1] = (key[key.size - 1] + 1).toByte()
    val hex = key.joinToString("") { "%02x".format(it) }
    database.useWriterConnection { it.executeSQL("UPDATE attachment SET wrappedKey = x'$hex' WHERE id = '$id'") }
}

/**
 * The database refuses to bring a deleted note back from now on, as a disk
 * that refuses a write, and takes every other write: an Undo fails, and a
 * wipe would not.
 */
fun refuseBringingNotesBack() = runBlocking {
    testApp.test.database.useWriterConnection {
        it.executeSQL(
            "CREATE TRIGGER refuse_back BEFORE UPDATE ON ${NoteEntity.TABLE} WHEN OLD.deletedAt IS NOT NULL AND NEW.deletedAt IS NULL " +
                "BEGIN SELECT RAISE(ABORT, 'refused'); END",
        )
    }
}

/**
 * Seals the key of the file [id] with the keys of other recovery words,
 * past the app, as the key of a file whose own keys were given up: the
 * file can no longer be opened.
 */
fun sealTheKeyOfWithOtherWords(id: String) = runBlocking {
    val other = keysOfOtherWords(NotesServices.APP_NAME)
    val hex = other.files.wrap(id, other.files.newFileKey()).joinToString("") { "%02x".format(it) }
    testApp.test.database.useWriterConnection { it.executeSQL("UPDATE attachment SET wrappedKey = x'$hex' WHERE id = '$id'") }
}

/**
 * Changes the last byte of the keyset file that seals the keys of the
 * files, on the disk, and drops the keys Notes holds in memory, as a lock
 * does: no file opens until the recovery key repairs the keyset.
 */
fun damageTheFileKeyset() {
    val app = ApplicationProvider.getApplicationContext<Application>()
    val keyset = File(app.filesDir, "shk-keys/file-key")
    keyset.writeBytes(keyset.readBytes().also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() })
    (app as SecurityHost).crypto.appLock.lock()
}

private const val WAIT_MILLIS = 5_000L
private const val BYTE = 0xFF
