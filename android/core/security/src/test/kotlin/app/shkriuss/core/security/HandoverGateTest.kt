package app.shkriuss.core.security

import android.app.Activity
import android.content.ComponentName
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.ProviderInfo
import android.content.pm.Signature
import android.content.pm.SigningInfo
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.os.Looper
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.ViewModelProvider
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.KeyId
import java.io.File
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The real gate of the handover (ADR 0041, points 8 to 11): the checks as
 * Android's package manager answers them, the keeper's handover screen as
 * Android starts it, and the status provider. The suite defines no
 * permission, so any app may reach these parts. Every test here sends
 * them a caller or a request that must get nothing.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
class HandoverGateTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val app = RuntimeEnvironment.getApplication()
    private val packages = shadowOf(app.packageManager)
    private val suiteCertificate = byteArrayOf(1, 2, 3, 4, 5)
    private val otherCertificate = byteArrayOf(9, 8, 7)
    private val oldCertificate = byteArrayOf(4, 4, 4)
    private val reminders = AppName.of("reminders")

    @Before
    fun signThisAppWithTheSuiteKey() {
        signThisApp(suiteCertificate)
    }

    /** Signs this app, the keeper of the tests, with [certificate] alone. */
    private fun signThisApp(certificate: ByteArray) {
        packages.getInternalMutablePackageInfo(app.packageName).signingInfo = signing(listOf(certificate), null)
    }

    /** Signing information with [current] signers now and, if given, the lineage [history]. Robolectric reads it from its shadow. */
    private fun signing(current: List<ByteArray>, history: List<ByteArray>?) = SigningInfo().also { info ->
        shadowOf(info).setSignatures(current.map(::Signature).toTypedArray())
        history?.let { shadowOf(info).setPastSigningCertificates(it.map(::Signature).toTypedArray()) }
    }

    /** Installs [packageName], signed with [current] now, after the lineage [history] if one is given. */
    private fun install(packageName: String, current: List<ByteArray>, history: List<ByteArray>? = null) {
        val info = PackageInfo().apply {
            this.packageName = packageName
            applicationInfo = ApplicationInfo().apply { this.packageName = packageName }
            signingInfo = signing(current, history)
        }
        packages.installPackage(info)
    }

    @Test
    fun anotherDataAppSignedNowWithExactlyThisCertificateTakesPart() {
        install("app.shkriuss.reminders", current = listOf(suiteCertificate))
        assertEquals(reminders, AndroidSuiteApps(app).peerName("app.shkriuss.reminders"))

        install("app.shkriuss.notes", current = listOf(suiteCertificate), history = listOf(oldCertificate, suiteCertificate))
        assertEquals("a rotated app whose current certificate is this one", AppName.of("notes"), AndroidSuiteApps(app).peerName("app.shkriuss.notes"))
    }

    @Test
    fun everyOtherInstalledAppIsRefused() {
        install("app.shkriuss.other", current = listOf(otherCertificate))
        install("app.shkriuss.twosigners", current = listOf(suiteCertificate, otherCertificate))
        install("app.shkriuss.rotatedaway", current = listOf(otherCertificate), history = listOf(suiteCertificate, otherCertificate))
        install("app.shkriuss.sync", current = listOf(suiteCertificate))
        install("app.shkriuss.catalog", current = listOf(suiteCertificate))
        install("app.shkriuss.reminders.preview", current = listOf(suiteCertificate))
        install("com.example.reminders", current = listOf(suiteCertificate))
        val suite = AndroidSuiteApps(app)

        mapOf(
            "app.shkriuss.other" to "another certificate",
            "app.shkriuss.twosigners" to "two signers",
            "app.shkriuss.rotatedaway" to "a lineage from this certificate to another one",
            "app.shkriuss.sync" to "Sync holds no data keys",
            "app.shkriuss.catalog" to "Catalog holds no data keys",
            "app.shkriuss.reminders.preview" to "a preview, and this app is not one",
            "com.example.reminders" to "not a package of the suite",
            "app.shkriuss.missing" to "not installed",
        ).forEach { (packageName, why) -> assertNull(why, suite.peerName(packageName)) }
    }

    @Test
    fun anAppOnTheOldKeyAndAnAppOnTheNewKeyRefuseEachOther() {
        signThisApp(oldCertificate)
        install("app.shkriuss.reminders", current = listOf(suiteCertificate), history = listOf(oldCertificate, suiteCertificate))
        assertNull("the lineage is not compared, only the current certificate", AndroidSuiteApps(app).peerName("app.shkriuss.reminders"))
    }

    /** Starts the keeper's handover screen as Android would for [caller], with [extras]. */
    private fun startHandover(caller: String?, extras: Bundle?): Activity {
        val intent = Intent(app, HandoverActivity::class.java).apply { extras?.let(::putExtras) }
        val controller = Robolectric.buildActivity(HandoverActivity::class.java, intent)
        shadowOf(controller.get()).setCallingPackage(caller)
        return controller.create().get()
    }

    private fun request(version: Any? = Handover.VERSION, mode: Any? = HandoverMode.KEYS.name) = Bundle().apply {
        when (version) {
            is Int -> putInt(Handover.EXTRA_VERSION, version)
            is String -> putString(Handover.EXTRA_VERSION, version)
        }
        when (mode) {
            is String -> putString(Handover.EXTRA_MODE, mode)
            is Int -> putInt(Handover.EXTRA_MODE, mode)
        }
    }

    private fun refusalOf(screen: Activity): String? = shadowOf(screen).resultIntent?.getStringExtra(Handover.EXTRA_REFUSAL)

    private fun showsNothing(screen: Activity): Boolean =
        screen.findViewById<ViewGroup>(android.R.id.content).childCount == 0

    @Test
    fun theHandoverScreenRefusesEveryCallerThatFailsTheCheckAndShowsNothing() {
        install("app.shkriuss.other", current = listOf(otherCertificate))
        install("app.shkriuss.reminders", current = listOf(suiteCertificate))

        listOf(null, "app.shkriuss.other", "app.shkriuss.missing", app.packageName).forEach { caller ->
            val screen = startHandover(caller, request())
            assertTrue("$caller: closed at once", screen.isFinishing)
            assertEquals("$caller: cancelled", Activity.RESULT_CANCELED, shadowOf(screen).resultCode)
            assertEquals("$caller: says why", HandoverRefusal.REFUSED.name, refusalOf(screen))
            assertTrue("$caller: no screen", showsNothing(screen))
        }
    }

    @Test
    fun aHostileRequestFromASuiteAppGetsNothingEither() {
        install("app.shkriuss.reminders", current = listOf(suiteCertificate))
        mapOf(
            "no extras at all" to null,
            "no version" to request(version = null),
            "a version of another type" to request(version = "1"),
            "an older version" to request(version = 0),
            "an unknown mode" to request(mode = "EVERYTHING"),
            "a mode of another type" to request(mode = 1),
            "no mode" to request(mode = null),
        ).forEach { (why, extras) ->
            val screen = startHandover("app.shkriuss.reminders", extras)
            assertTrue("$why: closed at once", screen.isFinishing)
            assertEquals("$why: cancelled", Activity.RESULT_CANCELED, shadowOf(screen).resultCode)
            assertEquals("$why: says why", HandoverRefusal.REFUSED.name, refusalOf(screen))
            assertTrue("$why: no screen", showsNothing(screen))
        }

        val newer = startHandover("app.shkriuss.reminders", request(version = Handover.VERSION + 1))
        assertEquals("a newer version", HandoverRefusal.UPDATE.name, refusalOf(newer))
        assertTrue(showsNothing(newer))
    }

    @Test
    fun aSuiteAppWithAValidRequestSeesTheScreen() {
        install("app.shkriuss.reminders", current = listOf(suiteCertificate))
        val screen = startHandover("app.shkriuss.reminders", request())
        assertTrue("the screen stays", !screen.isFinishing)
        assertTrue("it shows the screen", !showsNothing(screen))
    }

    @Test
    fun theKeysGoOnlyToTheAppThatAskedAfterASecondCheck() {
        install("app.shkriuss.reminders", current = listOf(suiteCertificate))
        val keeper = softwareApp(File(temporary.newFolder(), "shk-keys"))
        val key = keeper.crypto.setup.createRecoveryKey()
        keeper.crypto.setup.storeDerivedKeys(key)
        keeper.crypto.setup.beginKeepRecoveryKey(key)!!.finish()
        val keys = keeper.crypto.setup.beginHandOver(reminders).finish()
        val valid = HandoverRequest.Valid(reminders, "app.shkriuss.reminders", HandoverMode.KEYS)
        val suite = AndroidSuiteApps(app)

        val (code, data) = handoverResult("app.shkriuss.reminders", valid, suite, keys)
        assertEquals(Activity.RESULT_OK, code)
        assertNotNull(data!!.getByteArrayExtra("app.shkriuss.handover.RECORD"))

        fun refused(caller: String?, why: String) {
            val (refusedCode, refusedData) = handoverResult(caller, valid, suite, keys)
            assertEquals(why, Activity.RESULT_CANCELED, refusedCode)
            assertEquals(why, HandoverRefusal.REFUSED.name, refusedData?.getStringExtra(Handover.EXTRA_REFUSAL))
            assertNull("$why: no keys", refusedData?.getByteArrayExtra("app.shkriuss.handover.RECORD"))
        }
        refused(null, "no caller any more")
        refused("app.shkriuss.notes", "another app than the one that asked")
        install("app.shkriuss.reminders", current = listOf(otherCertificate))
        refused("app.shkriuss.reminders", "the asking app was replaced by one signed otherwise")
    }

    @Test
    fun theStatusProviderAnswersNoCallerThatItCannotName() {
        val provider = Robolectric.setupContentProvider(KeeperStatusProvider::class.java, "${app.packageName}.keeper")
        assertNull("Android named no caller", provider.call(Handover.METHOD_STATUS, null, null))
        assertNull("another call", provider.call("query", null, null))
        assertNull(provider.query(Uri.parse("content://${app.packageName}.keeper/"), null, null, null, null))
    }

    @Test
    fun theStatusProviderAnswersOnlyACallerThatPassesTheRealCheck() {
        install("app.shkriuss.reminders", current = listOf(suiteCertificate))
        install("app.shkriuss.other", current = listOf(otherCertificate))
        val host = app as TestHostApp
        val suite = AndroidSuiteApps(app)

        assertNotNull(KeeperStatusProvider.statusFor("app.shkriuss.reminders", suite, host))
        assertNull("another certificate", KeeperStatusProvider.statusFor("app.shkriuss.other", suite, host))
        assertNull("not installed", KeeperStatusProvider.statusFor("app.shkriuss.missing", suite, host))
    }

    /** The status provider of another app, which answers what [answers] holds for its authority. */
    class FakeStatus : ContentProvider() {
        private var authority: String? = null

        override fun attachInfo(context: Context?, info: ProviderInfo?) {
            authority = info?.authority
            super.attachInfo(context, info)
        }

        override fun onCreate(): Boolean = true

        override fun call(method: String, arg: String?, extras: Bundle?): Bundle? = answers[authority]

        override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null

        override fun getType(uri: Uri): String? = null

        override fun insert(uri: Uri, values: ContentValues?): Uri? = null

        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0

        companion object {
            val answers = mutableMapOf<String?, Bundle?>()
        }
    }

    /** Gives the installed app [packageName] a handover screen, as `core/security`'s manifest does. */
    private fun offerHandoverScreen(packageName: String) {
        val screen = ComponentName(packageName, HandoverActivity::class.java.name)
        packages.addActivityIfNotPresent(screen)
        packages.addIntentFilterForActivity(screen, IntentFilter(Handover.ACTION))
    }

    private fun answerStatus(packageName: String, answer: Bundle?) {
        val authority = Handover.statusAuthority(packageName)
        FakeStatus.answers[authority] = answer
        Robolectric.buildContentProvider(FakeStatus::class.java).create(ProviderInfo().apply { this.authority = authority })
    }

    @Test
    fun onlyCheckedAppsThatSayTheyKeepTheKeyAreListedAsKeepers() {
        val id = KeyId(0x0a0b0c0d)
        install("app.shkriuss.reminders", current = listOf(suiteCertificate))
        install("app.shkriuss.notes", current = listOf(suiteCertificate))
        install("app.shkriuss.thief", current = listOf(otherCertificate))
        listOf("app.shkriuss.reminders", "app.shkriuss.notes", "app.shkriuss.thief").forEach(::offerHandoverScreen)
        answerStatus("app.shkriuss.reminders", KeeperStatus.bundleOf(id))
        answerStatus("app.shkriuss.notes", KeeperStatus.bundleOf(null))
        answerStatus("app.shkriuss.thief", KeeperStatus.bundleOf(id))

        val keepers = AndroidSuiteApps(app).keepers()
        assertEquals(listOf("app.shkriuss.reminders"), keepers.map { it.packageName })
        assertEquals("0a0b0c0d", keepers.single().keyId)
        assertNotNull(AndroidSuiteApps(app).handoverIntent("app.shkriuss.reminders", HandoverMode.KEYS))
    }

    /**
     * The asking screen, with a [KeeperCall] made in `onCreate` as the real
     * screens make it. It knows which keeper to ask only until Android makes
     * it anew, as the turn-on screen's model.
     */
    internal class AskingScreen : ComponentActivity() {
        val answers = mutableListOf<Pair<String, KeeperAnswer>>()
        var toAsk: String? = "app.shkriuss.water"
        lateinit var call: KeeperCall

        override fun onCreate(savedInstanceState: Bundle?) {
            super.onCreate(savedInstanceState)
            if (savedInstanceState != null) toAsk = null
            val suite = FakeSuiteApps(peers = mapOf("app.shkriuss.water" to AppName.of("water")))
            call = KeeperCall(this, suite, keeper = { toAsk }, onAnswer = { keeper, answer -> answers += keeper to answer })
        }
    }

    /** A screen that registers its callback the usual way, with its lifecycle: what [KeeperCall] must not do. */
    internal class UsualScreen : ComponentActivity() {
        val results = mutableListOf<ActivityResult>()
        val launcher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { results += it }
    }

    @Test
    fun anAnswerThatComesWhileTheScreenIsStoppedIsHandedOverAtOnceAndNeverSaved() {
        val controller = Robolectric.buildActivity(AskingScreen::class.java).setup()
        val screen = controller.get()
        screen.call.ask(HandoverMode.KEYS)
        val asked = shadowOf(screen).peekNextStartedActivityForResult()
        assertNotNull("the keeper's screen was opened", asked)

        // The keeper's screen covers this one, so this one is stopped when the answer comes.
        controller.pause().stop()
        shadowOf(screen).receiveResult(asked.intent, Activity.RESULT_CANCELED, refusalResult(HandoverRefusal.NOT_KEEPER))
        assertEquals("handed over at once, while stopped", listOf<Pair<String, KeeperAnswer>>("app.shkriuss.water" to KeeperAnswer.NotKeeper), screen.answers)

        val saved = Bundle()
        controller.saveInstanceState(saved)
        assertTrue("no pending result in the saved state", pendingResults(saved).isEmpty())
    }

    @Test
    fun anAnswerAfterAndroidMadeTheScreenAnewStillReachesItWithTheAppThatWasAsked() {
        val first = Robolectric.buildActivity(AskingScreen::class.java).setup()
        first.get().call.ask(HandoverMode.KEYS)
        val asked = shadowOf(first.get()).peekNextStartedActivityForResult()

        // The keeper's screen is in front; Android saves this screen and ends the process.
        first.pause().stop()
        val saved = Bundle()
        first.saveInstanceState(saved)
        assertTrue("no result is waiting in the saved state", pendingResults(saved).isEmpty())

        // When the keeper answers, Android makes the screen anew from the saved state alone.
        val second = Robolectric.buildActivity(AskingScreen::class.java).create(saved).start()
        assertNull("the new screen no longer knows whom it asked", second.get().toAsk)
        // What ComponentActivity.onActivityResult does with the answer.
        assertTrue(second.get().activityResultRegistry.dispatchResult(asked.requestCode, Activity.RESULT_CANCELED, refusalResult(HandoverRefusal.NOT_KEEPER)))
        assertEquals(listOf<Pair<String, KeeperAnswer>>("app.shkriuss.water" to KeeperAnswer.NotKeeper), second.get().answers)
    }

    @Test
    fun theKeepersScreenSaysNotKeeperWhenItClosesWithoutAKeyAnyWay() {
        // This app keeps no recovery key, so its handover screen shows that it is not a keeper.
        install("app.shkriuss.reminders", current = listOf(suiteCertificate))
        val intent = Intent(app, HandoverActivity::class.java).putExtras(request())
        val controller = Robolectric.buildActivity(HandoverActivity::class.java, intent)
        shadowOf(controller.get()).setCallingPackage("app.shkriuss.reminders")
        val screen = controller.setup().get()
        // The keeper reads its keys on a background thread. Wait for that, however slow the machine is.
        val model = ViewModelProvider(screen as ComponentActivity)[HandoverViewModel::class.java]
        val deadline = System.nanoTime() + Duration.ofSeconds(60).toNanos()
        while (model.state.value != HandoverNotKept && System.nanoTime() < deadline) Thread.sleep(10)
        assertEquals("the keeper keeps no key", HandoverNotKept, model.state.value)
        // Then the screen draws the new state. That takes the main thread's turns and some real time too.
        while (refusalOf(screen) == null && System.nanoTime() < deadline) {
            Thread.sleep(10)
            shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(20))
        }
        assertEquals("set while the screen shows, so Back gives it too", HandoverRefusal.NOT_KEEPER.name, refusalOf(screen))
        screen.onBackPressedDispatcher.onBackPressed()
        assertTrue(screen.isFinishing)
        assertEquals(Activity.RESULT_CANCELED, shadowOf(screen).resultCode)
        assertEquals(HandoverRefusal.NOT_KEEPER.name, refusalOf(screen))
    }

    @Test
    fun theGetKeysScreenMadeAnewWaitsOnlyWhileAnAnswerIsStillToCome() {
        install("app.shkriuss.water", current = listOf(suiteCertificate))
        offerHandoverScreen("app.shkriuss.water")
        val intent = SecurityScreens.getKeysIntent(app, "app.shkriuss.water")
        val first = Robolectric.buildActivity(GetKeysActivity::class.java, intent).setup()
        val asked = shadowOf(first.get()).peekNextStartedActivityForResult()
        assertNotNull("Water's screen was opened", asked)

        // Android ends the process while Water's screen is in front: the new screen waits for the answer.
        first.pause().stop()
        val waiting = Bundle().also(first::saveInstanceState)
        assertTrue(!Robolectric.buildActivity(GetKeysActivity::class.java, intent).create(waiting).get().isFinishing)

        // The answer came and was handled; later Android makes the screen anew. Nothing will come, so it closes.
        first.get().activityResultRegistry.dispatchResult(asked.requestCode, Activity.RESULT_CANCELED, refusalResult(HandoverRefusal.NOT_KEEPER))
        val answered = Bundle().also(first::saveInstanceState)
        assertTrue("no screen that waits for ever", Robolectric.buildActivity(GetKeysActivity::class.java, intent).create(answered).get().isFinishing)
    }

    @Test
    fun theTestSeesAPendingResultWhereAUsualCallbackLeavesOne() {
        val controller = Robolectric.buildActivity(UsualScreen::class.java).setup()
        val screen = controller.get()
        screen.launcher.launch(Intent().setClassName("app.shkriuss.water", HandoverActivity::class.java.name))
        val asked = shadowOf(screen).peekNextStartedActivityForResult()

        controller.pause().stop()
        shadowOf(screen).receiveResult(asked.intent, Activity.RESULT_CANCELED, refusalResult(HandoverRefusal.NOT_KEEPER))
        assertTrue("it waits for the screen to start", screen.results.isEmpty())

        val saved = Bundle()
        controller.saveInstanceState(saved)
        assertEquals("and it is in the saved state", listOf(PENDING_RESULTS), pendingResults(saved))
    }

    /** Every pending result that AndroidX keeps in a saved state, at any depth. */
    private fun pendingResults(state: Bundle): List<String> = state.keySet().flatMap { key ->
        @Suppress("DEPRECATION")
        when (val value = state.get(key)) {
            is Bundle -> if (key == PENDING_RESULTS && !value.isEmpty) listOf(key) else pendingResults(value)
            else -> emptyList()
        }
    }

    private companion object {
        /** Where AndroidX's result registry saves the results that no callback took yet. */
        const val PENDING_RESULTS = "KEY_COMPONENT_ACTIVITY_PENDING_RESULT"
    }
}
