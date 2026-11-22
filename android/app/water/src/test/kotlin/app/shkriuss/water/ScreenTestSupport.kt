package app.shkriuss.water

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.annotation.StringRes
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.performSemanticsAction
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
import app.shkriuss.feature.water.BackupStep
import app.shkriuss.feature.water.WaterRepository
import app.shkriuss.feature.water.WaterServices
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf

/** The app class of the test. */
val testApp: WaterTestApp
    get() = ApplicationProvider.getApplicationContext<Application>() as WaterTestApp

/** The words of string [id] of the app, with [args]. */
fun words(@StringRes id: Int, vararg args: Any): String =
    ApplicationProvider.getApplicationContext<Application>().getString(id, *args)

/** Writes what a test starts with, before the screen starts, as the user would have. */
fun seed(write: suspend WaterRepository.() -> Unit) = runBlocking { testApp.test.services.repository.write() }

/** The phone's "Use 24-hour format", as in the spec's examples: "14:05". */
fun use24HourClock() {
    Settings.System.putString(ApplicationProvider.getApplicationContext<Application>().contentResolver, Settings.System.TIME_12_24, "24")
}

/** Waits up to five seconds, for the database, until something matches [matcher]. */
fun ComposeTestRule.waitFor(matcher: SemanticsMatcher) {
    waitUntil(WAIT_MILLIS) { onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
}

/** A field whose error, which TalkBack announces, is [text]. The text under the field is not read as well. */
fun hasError(text: String): SemanticsMatcher = SemanticsMatcher.expectValue(SemanticsProperties.Error, text)

/** Waits until something shows [text]. */
fun ComposeTestRule.waitForText(text: String, substring: Boolean = false) = waitFor(hasText(text, substring = substring))

/**
 * Taps the one thing that can be tapped and shows [text], as TalkBack
 * does: also below the edge of the window, and without a ripple, which
 * would differ from one run to the next in a screenshot.
 *
 * It first waits for that thing to show. A screen draws what it reads
 * from the database only once Room's thread has answered, and Compose
 * does not wait for that thread by itself.
 */
fun ComposeTestRule.tap(text: String, substring: Boolean = false) {
    val target = hasText(text, substring = substring) and hasClickAction()
    waitFor(target)
    onNode(target).tapAsTalkBack()
    waitForIdle()
}

/** Taps the one thing that can be tapped with the words of string [id]. */
fun ComposeTestRule.tap(@StringRes id: Int) = tap(words(id))

/** A tap as TalkBack makes it. */
fun SemanticsNodeInteraction.tapAsTalkBack(): SemanticsNodeInteraction = performSemanticsAction(SemanticsActions.OnClick)

private const val WAIT_MILLIS = 5_000L

/**
 * Waits until Settings shows all of its sections. Backup and Security come
 * once the keys were read, on a thread Compose does not wait for, so a
 * screenshot waits for them: otherwise it could be taken without them.
 */
fun ComposeTestRule.waitForSettings() {
    waitForText(words(app.shkriuss.feature.water.R.string.water_version))
    waitForText(words(app.shkriuss.feature.water.R.string.water_make_backup))
}

/** The backup file of the tests, as Water suggests its name on [THE_DAY]. */
const val BACKUP_NAME = "water-2026-11-13.shkbackup"

/**
 * Sets up the documents of the test's file picker, as files in a new
 * folder of the test app (`TestDocuments` of core/testing). Robolectric
 * shows no picker: a test hands the screen a document with [thePickerGives].
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

/** The screen of Android or of core/security that Water opened for a result and that still waits, or null. */
fun ActivityScenario<WaterActivity>.openedForResult(): Intent? {
    var opened: Intent? = null
    onActivity { opened = shadowOf(it).peekNextStartedActivityForResult()?.intent }
    return opened
}

/** Waits until Water has opened a screen for a result that [matches], and gives its intent. */
fun ComposeTestRule.waitForOpened(scenario: ActivityScenario<WaterActivity>, matches: (Intent) -> Boolean): Intent {
    waitUntil(WAIT_MILLIS) { scenario.openedForResult()?.let(matches) == true }
    return checkNotNull(scenario.openedForResult())
}

/**
 * The screen Water opened for a result closes. With [picked], it is
 * Android's file picker and the user picked that document. With null, the
 * user left it, or it is a screen of core/security, which sets no result.
 */
fun ComposeTestRule.theOpenedScreenCloses(scenario: ActivityScenario<WaterActivity>, picked: Uri? = null) {
    scenario.onActivity { activity ->
        val opened = shadowOf(activity).nextStartedActivityForResult
        val result = if (picked != null) Activity.RESULT_OK else Activity.RESULT_CANCELED
        shadowOf(activity).receiveResult(opened.intent, result, picked?.let { Intent().setData(it) })
    }
    waitForIdle()
}

/** The app of the test gets its keys from a new recovery key, as the create flow of core/security stores them. */
fun giveTheAppARecoveryKey() {
    val crypto = (ApplicationProvider.getApplicationContext<Application>() as SecurityHost).crypto
    crypto.setup.storeDerivedKeys(crypto.setup.createRecoveryKey())
}

/** Writes a backup of what the test's app holds now into the document [name], past the screens, and checks it. */
fun writeABackup(name: String = BACKUP_NAME): Uri {
    val document = TestDocuments.uri(name)
    val ended = runBlocking {
        val backups = testApp.test.services.backups
        backups.write(document) {}
    }
    check(ended is BackupStep.Written) { "The backup of the test was not written: $ended" }
    return document
}

/**
 * Writes a backup of [content] into the document [name], past the
 * screens, with the backup keys of [crypto] for the app [appName]: as
 * another app, other recovery words or a newer version of Water would
 * write it.
 */
fun writeABackupOf(
    content: BackupContent,
    crypto: ShkCrypto = (ApplicationProvider.getApplicationContext<Application>() as SecurityHost).crypto,
    appName: AppName = WaterServices.APP_NAME,
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

/** One record of the type [type], which Water does not know, not deleted. */
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
