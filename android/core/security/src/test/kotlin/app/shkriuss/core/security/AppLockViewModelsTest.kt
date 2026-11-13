package app.shkriuss.core.security

import android.os.Looper
import app.shkriuss.core.crypto.AppLockState
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import java.io.File
import kotlin.coroutines.CoroutineContext
import kotlin.random.Random
import kotlinx.coroutines.CoroutineDispatcher
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

/**
 * The lock screen, the app lock screen and turning the app lock on,
 * through their ViewModels, with real cryptography on the stand-in for
 * the Keystore. The system prompt is answered by calling what the screen
 * calls when Android answers it.
 */
@RunWith(RobolectricTestRunner::class)
class AppLockViewModelsTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val context = RuntimeEnvironment.getApplication()

    private fun newApp(): Pair<SoftwareKeysApp, File> {
        val folder = File(temporary.newFolder(), "shk-keys")
        return softwareApp(folder) to folder
    }

    private fun watcherOf(app: SoftwareKeysApp, onTextHidden: () -> Unit = {}) =
        AppLockWatcher(context, app.crypto, onTextHidden, elapsed = { 0L }, background = atOnce, main = atOnce)

    private fun withKeys(app: SoftwareKeysApp): RecoveryKey =
        app.crypto.setup.createRecoveryKey().also { app.crypto.setup.storeDerivedKeys(it) }

    private fun withTheAppLockOn(app: SoftwareKeysApp): RecoveryKey =
        withKeys(app).also { key -> app.crypto.appLock.beginTurnOn(app.crypto.setup.checkAllWords(key)!!).finish() }

    private fun keep(app: SoftwareKeysApp, key: RecoveryKey) = app.crypto.setup.beginKeepRecoveryKey(key)!!.finish()

    // The lock screen.

    private fun unlockModel(app: SoftwareKeysApp, onUnlocked: () -> Unit = {}) = UnlockViewModel(app.crypto, onUnlocked, inline)

    @Test
    fun theLockScreenShowsThePromptByItselfOnceForEachLock() {
        val (app, _) = newApp()
        withTheAppLockOn(app)
        app.crypto.appLock.lock()
        var unlocked = 0
        val model = unlockModel(app) { unlocked++ }

        model.onLocked(0)
        val prompt = model.state.value.prompt
        assertNotNull(prompt)
        model.onPromptResult(prompt!!, PromptOutcome.CANCELLED)
        assertEquals(LockScreen(), model.state.value)
        model.onLocked(0)
        assertNull("not again for the same lock", model.state.value.prompt)

        model.onLocked(1)
        model.onPromptResult(model.state.value.prompt!!, PromptOutcome.SUCCEEDED)

        assertEquals(1, unlocked)
        assertFalse(app.crypto.appLock.isLocked())
    }

    @Test
    fun aPromptThatFailedSaysSoAndTheButtonTriesAgain() {
        val (app, _) = newApp()
        withTheAppLockOn(app)
        app.crypto.appLock.lock()
        val model = unlockModel(app)

        model.onUnlock()
        model.onPromptResult(model.state.value.prompt!!, PromptOutcome.FAILED)
        assertEquals(LockNote.FAILED, model.state.value.note)

        model.onUnlock()
        assertNotNull(model.state.value.prompt)
        assertNull(model.state.value.note)
    }

    @Test
    fun aDamagedKeyFileOfTheAppLockSendsTheUserToTheWords() {
        val (app, folder) = newApp()
        withTheAppLockOn(app)
        app.crypto.appLock.lock()
        damage(File(folder, "file-key"))
        var unlocked = 0
        val model = unlockModel(app) { unlocked++ }

        model.onUnlock()
        model.onPromptResult(model.state.value.prompt!!, PromptOutcome.SUCCEEDED)

        assertEquals(LockNote.DAMAGED, model.state.value.note)
        assertEquals(0, unlocked)
        assertTrue(app.crypto.appLock.isLocked())
    }

    // The app lock screen.

    private fun appLockModel(app: SoftwareKeysApp, watcher: AppLockWatcher = watcherOf(app)) =
        AppLockViewModel(app.crypto, watcher, inline).also { it.refresh() }

    @Test
    fun withTheAppLockOffTheScreenShowsItsSettingsWithoutAPrompt() {
        val (app, _) = newApp()
        withKeys(app)

        val screen = appLockModel(app).state.value as AppLockSettingsScreen

        assertEquals(AppLockState.OFF, screen.state)
        assertNull("it can be turned on", screen.cannotTurnOn)
    }

    @Test
    fun theScreenSaysWhyTheAppLockCannotBeTurnedOn() {
        val (none, _) = newApp()
        assertEquals(CannotTurnOn.NO_RECOVERY_KEY, (appLockModel(none).state.value as AppLockSettingsScreen).cannotTurnOn)

        val (noLock, _) = newApp()
        withKeys(noLock)
        noLock.screenLock = false
        assertEquals(CannotTurnOn.NO_SCREEN_LOCK, (appLockModel(noLock).state.value as AppLockSettingsScreen).cannotTurnOn)

        val (moving, _) = newApp()
        moving.crypto.files.wrap("0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff", moving.crypto.files.newFileKey())
        withKeys(moving)
        assertTrue(moving.crypto.setup.fileKeyMoveIsPending())
        assertEquals(CannotTurnOn.FILE_KEYS_MOVING, (appLockModel(moving).state.value as AppLockSettingsScreen).cannotTurnOn)
    }

    @Test
    fun withTheAppLockOnTheScreenShowsNothingBeforeThePromptAndClosesWhenItIsClosed() {
        val (app, _) = newApp()
        withTheAppLockOn(app)
        val model = appLockModel(app)
        assertEquals("even an unlocked app asks", AppLockAsking(), model.state.value)

        model.onAsk()
        model.onPromptResult((model.state.value as AppLockAsking).prompt!!, PromptOutcome.CANCELLED)

        assertEquals(AppLockClosed, model.state.value)
    }

    @Test
    fun afterThePromptTheSettingsShowAndTheAppIsUnlocked() {
        val (app, _) = newApp()
        withTheAppLockOn(app)
        app.crypto.appLock.lock()
        val watcher = watcherOf(app)
        val model = appLockModel(app, watcher)

        model.onAsk()
        model.onPromptResult((model.state.value as AppLockAsking).prompt!!, PromptOutcome.SUCCEEDED)

        assertEquals(AppLockState.ON, (model.state.value as AppLockSettingsScreen).state)
        assertFalse(app.crypto.appLock.isLocked())
        assertEquals(AppGate.OPEN, watcher.gate.value)
        model.refresh()
        assertTrue("the same opening asks once", model.state.value is AppLockSettingsScreen)
    }

    @Test
    fun aTurnOfThePhoneDuringThePromptAsksAgainAndALockWhileAwayAsksAgain() {
        val (app, _) = newApp()
        withTheAppLockOn(app)
        val model = appLockModel(app)

        model.onAsk()
        model.onPromptResult((model.state.value as AppLockAsking).prompt!!, PromptOutcome.GONE)
        assertEquals(AppLockAsking(), model.state.value)
        model.onAsk()
        model.onPromptResult((model.state.value as AppLockAsking).prompt!!, PromptOutcome.SUCCEEDED)
        assertTrue(model.state.value is AppLockSettingsScreen)

        app.crypto.appLock.lock()
        model.refresh()

        assertEquals(AppLockAsking(), model.state.value)
    }

    @Test
    fun theSettingsAreKeptAndTheAppLockTurnsOff() {
        val (app, _) = newApp()
        withTheAppLockOn(app)
        val watcher = watcherOf(app)
        val model = appLockModel(app, watcher)
        model.onAsk()
        model.onPromptResult((model.state.value as AppLockAsking).prompt!!, PromptOutcome.SUCCEEDED)

        model.onLockAfter(LockAfter.FIFTEEN_MINUTES)
        model.onBlockScreenshots(true)
        model.onNotificationText(true)
        val again = watcherOf(app)
        assertEquals(LockAfter.FIFTEEN_MINUTES, again.lockAfter)
        assertTrue(again.blocksScreenshots)
        assertTrue(again.showsNotificationText)

        model.onTurnOff()

        assertEquals(AppLockState.OFF, (model.state.value as AppLockSettingsScreen).state)
        assertEquals(AppLockState.OFF, app.crypto.appLock.state())
        assertNull(watcher.notice)
    }

    // Turning the app lock on.

    private fun turnOnModel(app: SoftwareKeysApp, onTurnedOn: () -> Unit = {}) =
        TurnOnViewModel(app.crypto, onTurnedOn, inline, Random(7))

    private fun enterAll(model: TurnOnViewModel, words: List<String>) {
        words.forEach { word ->
            model.onTyped(word.take(2))
            model.onWord(word)
        }
        assertTrue((model.state.value as TurnOnAllWords).entry.complete)
        model.onCheckAll()
    }

    private fun answer(model: TurnOnViewModel, outcome: PromptOutcome) {
        val prompt = when (val screen = model.state.value) {
            is TurnOnReading -> screen.prompt
            is TurnOnLocking -> screen.prompt
            else -> null
        }
        assertNotNull("the system prompt is open in ${model.state.value}", prompt)
        model.onPromptResult(prompt!!, outcome)
    }

    @Test
    fun anAppThatDoesNotKeepTheKeyTakesAll24WordsAndKeepsNothing() {
        val (app, _) = newApp()
        val key = withKeys(app)
        var turnedOn = 0
        val model = turnOnModel(app) { turnedOn++ }
        assertEquals(TurnOnIntro(keeper = false), model.state.value)

        model.onContinue()
        enterAll(model, key.words())
        answer(model, PromptOutcome.SUCCEEDED)

        assertEquals(TurnOnDone, model.state.value)
        assertEquals(AppLockState.ON, app.crypto.appLock.state())
        assertEquals(1, turnedOn)
        assertFalse("the key is not kept in this flow", app.crypto.setup.keepsRecoveryKey())
    }

    @Test
    fun theWordsOfAnotherRecoveryKeyAreNoProof() {
        val (app, _) = newApp()
        withKeys(app)
        val model = turnOnModel(app)
        model.onContinue()

        enterAll(model, app.crypto.setup.createRecoveryKey().words())

        assertTrue((model.state.value as TurnOnAllWords).notThisApp)
        assertEquals(AppLockState.OFF, app.crypto.appLock.state())
    }

    @Test
    fun aKeeperAppAsksForFourWordsAfterOnePromptAndNeverShowsThem() {
        val (app, _) = newApp()
        val key = withKeys(app)
        keep(app, key)
        val words = key.words()
        val model = turnOnModel(app)
        assertEquals(TurnOnIntro(keeper = true), model.state.value)

        model.onContinue()
        answer(model, PromptOutcome.SUCCEEDED)
        val four = model.state.value as TurnOnFourWords
        assertEquals(4, four.positions.toSet().size)
        four.positions.forEachIndexed { index, _ -> model.onAnswerChange(index, "zoo") }
        model.onCheckFour()
        val missed = model.state.value as TurnOnFourWords
        assertTrue(missed.mismatch)
        assertEquals("the same four, and no words shown", four.positions, missed.positions)

        four.positions.forEachIndexed { index, position -> model.onAnswerChange(index, words[position - 1]) }
        model.onCheckFour()
        answer(model, PromptOutcome.SUCCEEDED)

        assertEquals(TurnOnDone, model.state.value)
        assertEquals(AppLockState.ON, app.crypto.appLock.state())
    }

    /** The kept recovery key the turn-on screen holds now, read from the ViewModel itself. */
    private fun keptKeyOf(model: TurnOnViewModel): Any? =
        TurnOnViewModel::class.java.getDeclaredField("kept").apply { isAccessible = true }.get(model)

    /** A keeper app, up to the four words. Returns the model. */
    private fun upToFourWords(app: SoftwareKeysApp, model: TurnOnViewModel = turnOnModel(app)): TurnOnViewModel {
        model.onContinue()
        answer(model, PromptOutcome.SUCCEEDED)
        assertTrue(model.state.value is TurnOnFourWords)
        assertNotNull(keptKeyOf(model))
        return model
    }

    @Test
    fun leavingTheScreenDuringTheFourWordsDropsTheKeptKeyAndThePromptAsksAgainOnTheWayBack() {
        val (app, _) = newApp()
        val key = withKeys(app)
        keep(app, key)
        val model = upToFourWords(app)
        model.onAnswerChange(0, "abandon")

        model.onStop(changingConfigurations = false)

        assertNull("the kept key left memory", keptKeyOf(model))
        assertEquals("back to the step before the prompt", TurnOnReading(), model.state.value)
        model.onCheckFour()
        assertEquals("nothing is checked without the key", TurnOnReading(), model.state.value)

        model.onStart()
        assertNotNull("the prompt asks again on the way back", (model.state.value as TurnOnReading).prompt)
        answer(model, PromptOutcome.SUCCEEDED)
        val four = model.state.value as TurnOnFourWords
        four.positions.forEachIndexed { index, position -> model.onAnswerChange(index, key.words()[position - 1]) }
        model.onCheckFour()
        answer(model, PromptOutcome.SUCCEEDED)
        assertEquals(TurnOnDone, model.state.value)
    }

    @Test
    fun aTurnOfThePhoneKeepsTheFourWordsAndAsksNothing() {
        val (app, _) = newApp()
        val key = withKeys(app)
        keep(app, key)
        val model = upToFourWords(app)
        val four = model.state.value as TurnOnFourWords
        four.positions.forEachIndexed { index, position -> model.onAnswerChange(index, key.words()[position - 1]) }
        val typed = model.state.value

        model.onStop(changingConfigurations = true)
        model.onStart()

        assertEquals(typed, model.state.value)
        assertNotNull(keptKeyOf(model))
        model.onCheckFour()
        assertTrue(model.state.value is TurnOnLocking)
    }

    @Test
    fun aStopWhileThePromptReadsTheKeptKeyKeepsNothing() {
        val (app, _) = newApp()
        val key = withKeys(app)
        keep(app, key)
        val queued = QueuedDispatcher()
        val model = TurnOnViewModel(app.crypto, {}, queued, Random(7))
        queued.runAll()
        model.onContinue()
        queued.runAll()
        val reading = (model.state.value as TurnOnReading).prompt!!

        model.onPromptResult(reading, PromptOutcome.SUCCEEDED)
        model.onStop(changingConfigurations = false)
        queued.runAll()

        assertNull("the key read after the stop is not kept", keptKeyOf(model))
        assertEquals(TurnOnReading(), model.state.value)
        model.onStart()
        queued.runAll()
        assertNotNull((model.state.value as TurnOnReading).prompt)
    }

    @Test
    fun aStopWithNoKeptKeyChangesNothing() {
        val (app, _) = newApp()
        val key = withKeys(app)
        val model = turnOnModel(app)
        model.onContinue()
        enterAll(model, key.words())
        val locking = model.state.value

        model.onStop(changingConfigurations = false)
        model.onStart()

        assertEquals(locking, model.state.value)
    }

    @Test
    fun aClosedPromptLeavesTheAppLockOffAndCanBeOpenedAgain() {
        val (app, _) = newApp()
        val key = withKeys(app)
        keep(app, key)
        val model = turnOnModel(app)
        model.onContinue()

        answer(model, PromptOutcome.CANCELLED)
        assertEquals(TurnOnReading(note = KeepNote.CANCELLED), model.state.value)
        model.onRead()
        answer(model, PromptOutcome.SUCCEEDED)
        val four = model.state.value as TurnOnFourWords
        four.positions.forEachIndexed { index, position -> model.onAnswerChange(index, key.words()[position - 1]) }
        model.onCheckFour()

        answer(model, PromptOutcome.CANCELLED)
        assertEquals(TurnOnLocking(note = KeepNote.CANCELLED), model.state.value)
        assertEquals(AppLockState.OFF, app.crypto.appLock.state())
    }

    @Test
    fun theLastPromptCanBeOpenedAgainWithTheSameCheck() {
        val (app, _) = newApp()
        val key = withKeys(app)
        val model = turnOnModel(app)
        model.onContinue()
        enterAll(model, key.words())

        answer(model, PromptOutcome.GONE)
        assertEquals(TurnOnLocking(), model.state.value)
        model.onLockAgain()
        answer(model, PromptOutcome.SUCCEEDED)

        assertEquals(TurnOnDone, model.state.value)
    }

    @Test
    fun aKeptKeyThatCannotBeReadAsksForAll24WordsInstead() {
        val (app, folder) = newApp()
        val key = withKeys(app)
        keep(app, key)
        damage(File(folder, "recovery"))
        val model = turnOnModel(app)
        model.onContinue()

        answer(model, PromptOutcome.SUCCEEDED)

        assertTrue((model.state.value as TurnOnAllWords).keptUnreadable)
        enterAll(model, key.words())
        answer(model, PromptOutcome.SUCCEEDED)
        assertEquals(TurnOnDone, model.state.value)
    }

    @Test
    fun anAppThatCannotTurnItOnSaysSo() {
        val (app, _) = newApp()
        withKeys(app)
        app.screenLock = false

        assertEquals(TurnOnFailed(TurnOnProblem.NOT_ALLOWED), turnOnModel(app).state.value)
    }
}

/** Holds background work until the test runs it, so that a test can stop the screen while work is under way. */
private class QueuedDispatcher : CoroutineDispatcher() {
    private val tasks = ArrayDeque<Runnable>()

    override fun dispatch(context: CoroutineContext, block: Runnable) {
        tasks += block
    }

    /** Runs the work that waits, and what it hands back to the main thread. */
    fun runAll() {
        while (tasks.isNotEmpty()) tasks.removeFirst().run()
        shadowOf(Looper.getMainLooper()).idle()
    }
}
