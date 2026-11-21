package app.shkriuss.core.security

import app.shkriuss.core.crypto.AppLockState
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.HandedOverKeys
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import java.io.File
import kotlin.random.Random
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

/**
 * Both sides of the handover between apps through their ViewModels, with
 * real cryptography on the stand-in for the Keystore (ADR 0041): the
 * keeper's screen, the asking app's screen, the question "keep it here
 * too", the check of four words for the app lock, and the security
 * screen's keepers. The system prompt is answered by calling what the
 * screen calls when Android answers it.
 */
@RunWith(RobolectricTestRunner::class)
class HandoverViewModelsTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val reminders = AppName.of("reminders")

    private fun app(name: AppName = testAppName): SoftwareKeysApp = SoftwareKeysApp(File(temporary.newFolder(), "shk-keys"), name)

    /** Water, keeping a new recovery key. */
    private fun keeper(): Pair<SoftwareKeysApp, RecoveryKey> {
        val keeper = app()
        val key = keeper.crypto.setup.createRecoveryKey()
        keeper.crypto.setup.storeDerivedKeys(key)
        keeper.crypto.setup.beginKeepRecoveryKey(key)!!.finish()
        return keeper to key
    }

    private fun handover(keeper: SoftwareKeysApp, mode: HandoverMode = HandoverMode.KEYS) =
        HandoverViewModel(keeper.crypto, reminders, mode, inline, Random(7), inline)

    private fun answer(model: HandoverViewModel, outcome: PromptOutcome) {
        val prompt = (model.state.value as HandoverAsk).prompt
        assertNotNull("the system prompt is open", prompt)
        model.onPromptResult(prompt!!, outcome)
    }

    private fun answerFour(model: HandoverViewModel, words: List<String>, wrong: Boolean = false) {
        val four = model.state.value as HandoverFourWords
        four.positions.forEachIndexed { index, position -> model.onAnswerChange(index, if (wrong) "zoo" else words[position - 1]) }
        model.onCheckFour()
    }

    private fun keysFrom(keeper: SoftwareKeysApp): HandedOverKeys = keeper.crypto.setup.beginHandOver(reminders).finish()

    @Test
    fun theKeeperAsksFirstThenThePromptMakesTheKeysAndTheScreenTakesThemOnce() {
        val (keeper, key) = keeper()
        val model = handover(keeper)
        assertEquals(HandoverAsk(HandoverMode.KEYS, key.keyId.toString()), model.state.value)
        assertNull("nothing before the user allows it", model.takeKeys())

        model.onAllow()
        answer(model, PromptOutcome.SUCCEEDED)
        assertEquals(HandoverReady, model.state.value)
        val keys = model.takeKeys()
        assertNotNull(keys)
        assertNull("the keys are taken once", model.takeKeys())
        assertFalse(keys!!.wordsChecked)

        val asker = app(reminders)
        assertEquals(app.shkriuss.core.crypto.KeySetupResult.STORED, asker.crypto.setup.storeHandedOverKeys(keys))
        assertEquals(key.keyId, asker.crypto.status().keyId)
        assertFalse(asker.crypto.status().keepsRecoveryKey)
    }

    @Test
    fun aClosedPromptGivesNothingAndAsksAgain() {
        val (keeper, key) = keeper()
        val model = handover(keeper)
        model.onAllow()
        answer(model, PromptOutcome.CANCELLED)
        assertEquals(HandoverAsk(HandoverMode.KEYS, key.keyId.toString(), note = KeepNote.CANCELLED), model.state.value)
        assertNull(model.takeKeys())

        model.onAllow()
        answer(model, PromptOutcome.FAILED)
        assertEquals(KeepNote.FAILED, (model.state.value as HandoverAsk).note)
        assertNull(model.takeKeys())
    }

    @Test
    fun anAppThatDoesNotKeepTheKeySaysSo() {
        val notKept = app()
        notKept.crypto.setup.storeDerivedKeys(notKept.crypto.setup.createRecoveryKey())
        assertEquals(HandoverNotKept, handover(notKept).state.value)
        assertEquals(HandoverNotKept, handover(app()).state.value)

        val (keeper, _) = keeper()
        val model = handover(keeper)
        keeper.screenLock = false
        model.onAllow()
        assertEquals("the guard went with the screen lock", HandoverNotKept, model.state.value)
    }

    @Test
    fun keysNotHandedOverLeaveMemoryWhenTheScreenStops() {
        val (keeper, _) = keeper()
        val model = handover(keeper)
        model.onAllow()
        answer(model, PromptOutcome.SUCCEEDED)
        model.onStop(changingConfigurations = true)
        assertEquals("a turn of the phone keeps them", HandoverReady, model.state.value)

        model.onStop(changingConfigurations = false)
        assertNull(model.takeKeys())
        assertTrue(model.state.value is HandoverAsk)
    }

    @Test
    fun aPromptAnsweredAfterAStopGivesNothing() {
        val (keeper, _) = keeper()
        val model = handover(keeper)
        model.onAllow()
        val prompt = (model.state.value as HandoverAsk).prompt!!
        model.onStop(changingConfigurations = false)
        model.onPromptResult(prompt, PromptOutcome.SUCCEEDED)
        assertNull(model.takeKeys())
        assertTrue(model.state.value is HandoverAsk)
    }

    @Test
    fun inTheCheckModeTheKeeperAsksForFourWordsAndMarksTheKeys() {
        val (keeper, key) = keeper()
        val model = handover(keeper, HandoverMode.CHECK_WORDS)
        model.onAllow()
        answer(model, PromptOutcome.SUCCEEDED)

        answerFour(model, key.words(), wrong = true)
        assertTrue((model.state.value as HandoverFourWords).mismatch)
        assertNull(model.takeKeys())

        answerFour(model, key.words())
        assertEquals(HandoverReady, model.state.value)
        assertTrue(model.takeKeys()!!.wordsChecked)
    }

    @Test
    fun theKeptKeyLeavesMemoryWhenTheScreenStopsDuringTheFourWords() {
        val (keeper, key) = keeper()
        val model = handover(keeper, HandoverMode.CHECK_WORDS)
        model.onAllow()
        answer(model, PromptOutcome.SUCCEEDED)
        model.onStop(changingConfigurations = false)
        assertEquals(HandoverAsk(HandoverMode.CHECK_WORDS, key.keyId.toString()), model.state.value)

        // Answers typed into a screen that is gone check nothing: the key is not in memory any more.
        model.onCheckFour()
        assertNull(model.takeKeys())
    }

    @Test
    fun theAskingAppStoresTheKeysAndSaysSo() {
        val (keeper, key) = keeper()
        val asker = app(reminders)
        val model = GetKeysViewModel(asker.crypto, inline)
        assertEquals(GetKeysWorking, model.state.value)

        model.onAnswer(KeeperAnswer.Keys(keysFrom(keeper)))
        assertEquals(GetKeysDone(key.keyId.toString()), model.state.value)
        assertTrue(asker.crypto.status().hasDerivedKeys)
    }

    @Test
    fun theAskingAppSaysWhyNothingWasStored() {
        val asker = app(reminders)
        val model = GetKeysViewModel(asker.crypto, inline)
        model.onAnswer(KeeperAnswer.Declined)
        assertEquals(GetKeysClosed, model.state.value)
        listOf(
            KeeperAnswer.NotKeeper to GetKeysProblem.NOT_KEEPER,
            KeeperAnswer.Update to GetKeysProblem.UPDATE,
            KeeperAnswer.Unreadable to GetKeysProblem.UNREADABLE,
            KeeperAnswer.NotASuiteApp to GetKeysProblem.NOT_A_SUITE_APP,
        ).forEach { (answer, problem) ->
            model.onAnswer(answer)
            assertEquals(GetKeysFailed(problem), model.state.value)
        }
        assertFalse(asker.crypto.status().hasDerivedKeys)

        val own = asker.crypto.setup.createRecoveryKey()
        asker.crypto.setup.storeDerivedKeys(own)
        val (keeper, _) = keeper()
        model.onAnswer(KeeperAnswer.Keys(keysFrom(keeper)))
        assertEquals(GetKeysFailed(GetKeysProblem.DIFFERENT_KEY, own.keyId.toString()), model.state.value)
        assertEquals(own.keyId, asker.crypto.status().keyId)
    }

    @Test
    fun keysThatBringBackTheFilesOfAResetAppLockSaySoAndTellTheWatcher() {
        val (keeper, key) = keeper()
        val asker = app(reminders)
        asker.crypto.setup.storeHandedOverKeys(keysFrom(keeper))
        asker.crypto.appLock.beginTurnOn(asker.crypto.setup.checkAllWords(key)!!).finish()
        // Locked when the screen lock goes: the file keys are not in memory, so the app lock is reset.
        asker.crypto.appLock.lock()
        asker.screenLock = false
        assertEquals(AppLockState.RESET, asker.crypto.appLock.state())

        var told = 0
        val model = GetKeysViewModel(asker.crypto, inline, onAppLockChanged = { told++ })
        model.onAnswer(KeeperAnswer.Keys(keysFrom(keeper)))
        assertEquals(GetKeysDone(key.keyId.toString(), appLockOff = true), model.state.value)
        assertEquals(1, told)
        assertEquals(AppLockState.OFF, asker.crypto.appLock.state())
    }

    @Test
    fun wordsEnteredWhileAnotherAppKeepsTheSameKeyAskBeforeKeeping() {
        val (_, key) = keeper()
        val asker = app(reminders)
        val notes = KeeperApp("app.shkriuss.notes", "Notes", key.keyId.toString())
        val suite = FakeSuiteApps(listOf(notes, KeeperApp("app.shkriuss.meals", "Meals", "00000001")))
        val model = EnterViewModel(asker.crypto, startOver = false, background = inline, suite = suite)
        key.words().forEach { word ->
            model.onTyped(word.take(2))
            model.onWord(word)
        }
        model.onCheck()
        assertEquals("only the keeper of the same key", FlowKeepAsk(listOf("Notes")), model.state.value)
        assertTrue("the keys are stored before the question", asker.crypto.status().hasDerivedKeys)

        model.onKeepHereToo()
        val prompt = (model.state.value as FlowKeeping).prompt!!
        model.onPromptResult(prompt, PromptOutcome.SUCCEEDED)
        assertEquals(FlowDone(Kept.KEPT), model.state.value)
        assertTrue(asker.crypto.status().keepsRecoveryKey)
    }

    @Test
    fun notNowKeepsOnlyThePaperCopyAndNoKeeperMeansNoQuestion() {
        val (_, key) = keeper()
        val notes = KeeperApp("app.shkriuss.notes", "Notes", key.keyId.toString())
        val asked = EnterViewModel(app(reminders).crypto, startOver = false, background = inline, suite = FakeSuiteApps(listOf(notes)))
        key.words().forEach { asked.onTyped(it); asked.onWord(it) }
        asked.onCheck()
        asked.onSkipKeeping()
        assertEquals(FlowDone(Kept.NOT_KEPT), asked.state.value)

        val alone = EnterViewModel(app(reminders).crypto, startOver = false, background = inline, suite = FakeSuiteApps())
        key.words().forEach { alone.onTyped(it); alone.onWord(it) }
        alone.onCheck()
        assertTrue("no other keeper: the prompt at once", (alone.state.value as FlowKeeping).prompt != null)
    }

    @Test
    fun aKeeperChecksFourWordsAndTheAppLockGoesOn() {
        val (keeper, key) = keeper()
        val asker = app(reminders)
        asker.crypto.setup.storeHandedOverKeys(keysFrom(keeper))
        val water = KeeperApp("app.shkriuss.water", "Water", key.keyId.toString())
        val suite = FakeSuiteApps(listOf(water, KeeperApp("app.shkriuss.meals", "Meals", "00000001")))
        var turnedOn = 0
        val model = TurnOnViewModel(asker.crypto, unlockMark = { 0 }, onTurnedOn = { turnedOn++ }, background = inline, random = Random(7), suite = suite)
        val intro = model.state.value as TurnOnIntro
        assertFalse(intro.keeper)
        assertEquals("only the keepers of this app's key", listOf(water), intro.keepers)

        model.onCheckAtKeeper(water)
        assertEquals("app.shkriuss.water", model.checkingAt)
        val kept = keeper.crypto.setup.beginShowRecoveryKey().finish()
        val words = key.words()
        val checked = keeper.crypto.setup.handOverAfterWords(kept, listOf(2, 5, 11, 20).associateWith { words[it - 1] }, reminders)!!
        model.onKeeperAnswer("app.shkriuss.water", KeeperAnswer.Keys(checked))
        val locking = (model.state.value as TurnOnLocking).prompt!!
        model.onPromptResult(locking, PromptOutcome.SUCCEEDED)
        assertEquals(TurnOnDone, model.state.value)
        assertEquals(1, turnedOn)
        assertEquals(AppLockState.ON, asker.crypto.appLock.state())
        assertFalse("the check keeps nothing", asker.crypto.status().keepsRecoveryKey)
    }

    @Test
    fun anAnswerThatComesBeforeTheWarningIsReadWaitsForIt() {
        // Android ended the process while Water's screen was in front, and made this screen anew: a new model,
        // which reads the warning in the background while Water's answer comes.
        val (keeper, key) = keeper()
        val asker = app(reminders)
        asker.crypto.setup.storeHandedOverKeys(keysFrom(keeper))
        val water = KeeperApp("app.shkriuss.water", "Water", key.keyId.toString())
        val background = QueuedDispatcher()
        val model = TurnOnViewModel(asker.crypto, unlockMark = { 0 }, onTurnedOn = {}, background = background, random = Random(7), suite = FakeSuiteApps(listOf(water)))
        assertEquals(TurnOnWorking, model.state.value)

        val kept = keeper.crypto.setup.beginShowRecoveryKey().finish()
        val words = key.words()
        val checked = keeper.crypto.setup.handOverAfterWords(kept, listOf(2, 5, 11, 20).associateWith { words[it - 1] }, reminders)!!
        model.onKeeperAnswer("app.shkriuss.water", KeeperAnswer.Keys(checked))
        assertEquals("nothing yet", TurnOnWorking, model.state.value)
        background.runAll()
        background.runAll()
        assertTrue("the checked words are the proof: the last prompt", (model.state.value as TurnOnLocking).prompt != null)
    }

    @Test
    fun aCheckThatDidNotWorkGoesBackToTheWarning() {
        val (keeper, key) = keeper()
        val asker = app(reminders)
        asker.crypto.setup.storeHandedOverKeys(keysFrom(keeper))
        val water = KeeperApp("app.shkriuss.water", "Water", key.keyId.toString())
        val model = TurnOnViewModel(asker.crypto, unlockMark = { 0 }, onTurnedOn = {}, background = inline, random = Random(7), suite = FakeSuiteApps(listOf(water)))
        val intro = model.state.value as TurnOnIntro

        model.onCheckAtKeeper(water)
        model.onKeeperAnswer("app.shkriuss.water", KeeperAnswer.Declined)
        assertEquals("the user said no: no note", intro, model.state.value)

        model.onCheckAtKeeper(water)
        model.onKeeperAnswer("app.shkriuss.water", KeeperAnswer.Keys(keysFrom(keeper)))
        assertEquals("keys without the words are no proof", intro.copy(keeperFailed = "Water"), model.state.value)

        model.onCheckAtKeeper(water)
        model.onKeeperAnswer("app.shkriuss.water", KeeperAnswer.NotKeeper)
        assertEquals(intro.copy(keeperFailed = "Water"), model.state.value)
        assertEquals(AppLockState.OFF, asker.crypto.appLock.state())

    }

    @Test
    fun theSecurityScreenListsTheKeepersAndWhichOfThemKeepThisAppsKey() {
        val (keeper, key) = keeper()
        val water = KeeperApp("app.shkriuss.water", "Water", key.keyId.toString())
        val meals = KeeperApp("app.shkriuss.meals", "Meals", "00000001")
        val asker = app(reminders)
        val suite = FakeSuiteApps(listOf(water, meals))
        val model = SecurityViewModel(asker.crypto, inline, suite)

        model.refresh()
        assertEquals(RecoveryKeyState.NONE, model.state.value.recoveryKey)
        assertEquals(listOf(water, meals), model.state.value.keepers)
        assertEquals(emptyList<KeeperApp>(), model.state.value.ownKeepers)

        asker.crypto.setup.storeHandedOverKeys(keysFrom(keeper))
        model.refresh()
        assertEquals(Kept.NOT_KEPT, model.state.value.kept)
        assertEquals(listOf(water), model.state.value.ownKeepers)
    }
}
