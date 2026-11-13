package app.shkriuss.core.security

import app.shkriuss.core.crypto.HardwareKeyKind
import app.shkriuss.core.crypto.RecoveryKey
import app.shkriuss.core.crypto.RecoveryWords
import app.shkriuss.core.crypto.RecoveryWordsResult
import app.shkriuss.core.crypto.SecurityLevel
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
 * Each flow of the recovery key, through its ViewModel, with real
 * cryptography on the stand-in for the Keystore. The system prompt is
 * answered by calling what the screen calls when Android answers it.
 */
@RunWith(RobolectricTestRunner::class)
class FlowViewModelsTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private fun newApp(): Pair<SoftwareKeysApp, File> {
        val folder = File(temporary.newFolder(), "shk-keys")
        return softwareApp(folder) to folder
    }

    private fun create(app: SoftwareKeysApp, startOver: Boolean = false) =
        CreateViewModel(app.crypto, startOver, inline, Random(7))

    private fun enter(app: SoftwareKeysApp, startOver: Boolean = false) = EnterViewModel(app.crypto, startOver, inline)

    /** Goes through the create flow to the keeping step, with a wrong answer first. Returns the words. */
    private fun createUpToKeeping(model: CreateViewModel): List<String> {
        assertEquals(CreateIntro, model.state.value)
        model.onShowWords()
        val words = (model.state.value as CreateWords).words
        assertEquals(24, words.size)

        model.onWordsWritten()
        val asked = model.state.value as CreateConfirm
        assertEquals(4, asked.positions.toSet().size)
        assertEquals(asked.positions.sorted(), asked.positions)
        assertTrue(asked.positions.all { it in 1..24 })
        asked.positions.forEachIndexed { index, _ -> model.onAnswerChange(index, "zoo") }
        model.onCheck()
        val again = model.state.value as CreateWords
        assertTrue("a wrong answer goes back to the words", again.mismatch)
        assertEquals("the same key", words, again.words)

        model.onWordsWritten()
        val confirm = model.state.value as CreateConfirm
        confirm.positions.forEachIndexed { index, position -> model.onAnswerChange(index, words[position - 1]) }
        model.onCheck()
        return words
    }

    private fun answer(model: FlowViewModel<*>, outcome: PromptOutcome) {
        val prompt = (model.state.value as FlowKeeping).prompt
        assertNotNull("the system prompt is open", prompt)
        model.onPromptResult(prompt!!, outcome)
    }

    private fun enterAll(model: EnterViewModel, words: List<String>) {
        words.forEach { word ->
            model.onTyped(word.take(2))
            model.onWord(word)
        }
        assertTrue((model.state.value as EnterWords).complete)
        model.onCheck()
    }

    @Test
    fun createShowsTheWordsAsksForFourStoresTheKeysAndKeepsTheKeyAfterThePrompt() {
        val (app, _) = newApp()
        val model = create(app)
        val words = createUpToKeeping(model)

        assertTrue("the keys are stored before the prompt", app.crypto.status().hasDerivedKeys)
        answer(model, PromptOutcome.SUCCEEDED)

        assertEquals(FlowDone(Kept.KEPT), model.state.value)
        assertTrue(app.crypto.status().keepsRecoveryKey)
        assertEquals(words, app.crypto.setup.beginShowRecoveryKey().finish().words())
    }

    @Test
    fun aClosedPromptCanBeOpenedAgainOrTheKeyIsNotKept() {
        val (app, _) = newApp()
        val model = create(app)
        createUpToKeeping(model)

        answer(model, PromptOutcome.CANCELLED)
        assertEquals(FlowKeeping(note = KeepNote.CANCELLED), model.state.value)
        model.onKeepAgain()
        answer(model, PromptOutcome.GONE)
        assertEquals("the screen went away: the button again, no note", FlowKeeping(), model.state.value)
        model.onSkipKeeping()

        assertEquals(FlowDone(Kept.NOT_KEPT), model.state.value)
        assertFalse(app.crypto.status().keepsRecoveryKey)
        assertTrue(app.crypto.status().hasDerivedKeys)
    }

    @Test
    fun aPromptThatIsNoLongerShownIsIgnored() {
        val (app, _) = newApp()
        val model = create(app)
        createUpToKeeping(model)
        val first = (model.state.value as FlowKeeping).prompt!!
        model.onPromptResult(first, PromptOutcome.CANCELLED)
        model.onKeepAgain()

        model.onPromptResult(first, PromptOutcome.SUCCEEDED)

        assertNotNull((model.state.value as FlowKeeping).prompt)
        assertFalse(app.crypto.status().keepsRecoveryKey)
    }

    @Test
    fun withoutAScreenLockTheKeyIsNotKeptAndTheFlowSaysSo() {
        val (app, _) = newApp()
        app.screenLock = false
        val model = create(app)
        createUpToKeeping(model)

        assertEquals(FlowDone(Kept.NO_SCREEN_LOCK), model.state.value)
        assertTrue(app.crypto.status().hasDerivedKeys)
    }

    @Test
    fun anAppWithKeysCannotCreateANewKeyHere() {
        val (app, _) = newApp()
        app.crypto.setup.storeDerivedKeys(app.crypto.setup.createRecoveryKey())

        assertEquals(FlowFailed(SecurityProblem.ALREADY_SET_UP), create(app).state.value)
    }

    @Test
    fun enteredWordsAreCheckedThenTheKeysAreStoredAndKept() {
        val (app, _) = newApp()
        val model = enter(app)

        // A published BIP-39 vector: 23 times "abandon", then "art". With "abandon" last, the checksum is wrong.
        enterAll(model, List(24) { "abandon" })
        assertTrue((model.state.value as EnterWords).doNotBelong)
        model.onEditWord(23)
        assertEquals("abandon", (model.state.value as EnterWords).typed)
        model.onWord("art")
        model.onCheck()
        answer(model, PromptOutcome.SUCCEEDED)

        assertEquals(FlowDone(Kept.KEPT), model.state.value)
        val expected = RecoveryWords.parse(List(23) { "abandon" }.plus("art").joinToString(" "))
        assertEquals((expected as RecoveryWordsResult.Accepted).recoveryKey.keyId, app.crypto.status().keyId)
    }

    @Test
    fun wordsOfAnotherRecoveryKeyAreRefusedAndNothingIsStored() {
        val (app, _) = newApp()
        val current = app.crypto.setup.createRecoveryKey()
        app.crypto.setup.storeDerivedKeys(current)
        val other = softwareApp(File(temporary.newFolder(), "k")).crypto.setup.createRecoveryKey()
        val model = enter(app)

        enterAll(model, other.words())

        assertEquals(EnterDifferentKey(current.keyId.toString()), model.state.value)
        assertEquals(current.keyId, app.crypto.status().keyId)
        model.onEnterOther()
        assertEquals(List(24) { "" }, (model.state.value as EnterWords).words)
    }

    @Test
    fun otherWordsInASetupThatStoppedOfferToStartOver() {
        val (app, folder) = newApp()
        val lost = app.crypto.setup.createRecoveryKey()
        stoppedSetup(app, folder, lost)
        val fresh = softwareApp(File(temporary.newFolder(), "k")).crypto.setup.createRecoveryKey()
        val model = enter(app)

        enterAll(model, fresh.words())
        assertEquals(EnterStartOverOffer, model.state.value)
        model.onStartOverWithThese()
        answer(model, PromptOutcome.SUCCEEDED)

        assertEquals(FlowDone(Kept.KEPT), model.state.value)
        assertEquals(fresh.keyId, app.crypto.status().keyId)
        assertFalse(app.crypto.status().setupIsUnfinished)
    }

    @Test
    fun startOverWithANewKeyFromTheSecurityScreen() {
        val (app, folder) = newApp()
        stoppedSetup(app, folder, app.crypto.setup.createRecoveryKey())
        val model = create(app, startOver = true)

        createUpToKeeping(model)
        answer(model, PromptOutcome.SUCCEEDED)

        assertEquals(FlowDone(Kept.KEPT), model.state.value)
        assertFalse(app.crypto.status().setupIsUnfinished)
        assertTrue(app.crypto.status().hasDerivedKeys)
    }

    @Test
    fun createWithoutStartOverInAStoppedSetupSendsTheUserToTheSecurityScreen() {
        val (app, folder) = newApp()
        stoppedSetup(app, folder, app.crypto.setup.createRecoveryKey())
        val model = create(app)

        createUpToKeeping(model)

        assertEquals(FlowFailed(SecurityProblem.SETUP_UNFINISHED), model.state.value)
    }

    @Test
    fun theRightWordsRepairADamagedKeyFile() {
        val (app, folder) = newApp()
        val key = app.crypto.setup.createRecoveryKey()
        app.crypto.setup.storeDerivedKeys(key)
        damage(File(folder, "record"))
        assertTrue(app.crypto.status().needsRepair)
        val model = enter(app)

        enterAll(model, key.words())
        answer(model, PromptOutcome.CANCELLED)
        model.onSkipKeeping()

        assertFalse(app.crypto.status().needsRepair)
        assertEquals(key.keyId, app.crypto.status().keyId)
    }

    @Test
    fun theKeptKeyIsShownOnceAfterThePromptAndLeavesWhenTheScreenStops() {
        val (app, _) = newApp()
        val key = app.crypto.setup.createRecoveryKey()
        app.crypto.setup.storeDerivedKeys(key)
        app.crypto.setup.beginKeepRecoveryKey(key)!!.finish()
        val model = ShowViewModel(app.crypto, inline)

        model.onShow()
        val closed = (model.state.value as ShowIntro).prompt!!
        model.onPromptResult(closed, PromptOutcome.CANCELLED)
        assertEquals(ShowIntro(), model.state.value)
        model.onShow()
        model.onPromptResult((model.state.value as ShowIntro).prompt!!, PromptOutcome.SUCCEEDED)
        assertEquals(ShowWords(key.words()), model.state.value)

        model.onStop()
        assertEquals(ShowIntro(), model.state.value)
    }

    @Test
    fun anAppThatDoesNotKeepTheKeySaysSo() {
        val (app, _) = newApp()
        app.crypto.setup.storeDerivedKeys(app.crypto.setup.createRecoveryKey())
        val model = ShowViewModel(app.crypto, inline)

        model.onShow()

        assertEquals(ShowNotKept, model.state.value)
    }

    @Test
    fun aDamagedKeptKeySendsTheUserToTheWords() {
        val (app, folder) = newApp()
        val key = app.crypto.setup.createRecoveryKey()
        app.crypto.setup.storeDerivedKeys(key)
        app.crypto.setup.beginKeepRecoveryKey(key)!!.finish()
        damage(File(folder, "recovery"))
        val model = ShowViewModel(app.crypto, inline)

        model.onShow()
        model.onPromptResult((model.state.value as ShowIntro).prompt!!, PromptOutcome.SUCCEEDED)

        assertEquals(ShowDamaged, model.state.value)
        assertTrue(app.crypto.status().needsRepair)
    }

    @Test
    fun theSecurityScreenShowsWhereTheKeyStandsAndWhereEachKeyLives() {
        val (app, _) = newApp()
        val model = SecurityViewModel(app.crypto, inline)
        model.refresh()
        assertEquals(SecurityState(loaded = true, kept = Kept.NOT_KEPT), model.state.value)

        val key = app.crypto.setup.createRecoveryKey()
        app.crypto.setup.storeDerivedKeys(key)
        app.crypto.setup.beginKeepRecoveryKey(key)!!.finish()
        model.refresh()
        val state = model.state.value
        assertEquals(RecoveryKeyState.SET_UP, state.recoveryKey)
        assertEquals(key.keyId.toString(), state.keyId)
        assertEquals(Kept.KEPT, state.kept)
        assertEquals(
            listOf(HardwareKeyKind.BACKGROUND, HardwareKeyKind.UNLOCKED, HardwareKeyKind.RECOVERY_GUARD),
            state.keys.map { it.kind },
        )
        assertTrue("the stand-in is software only", state.keys.all { it.level == SecurityLevel.SOFTWARE })
        assertTrue(state.softwareOnly)

        app.screenLock = false
        model.refresh()
        assertEquals(Kept.NO_SCREEN_LOCK, model.state.value.kept)
        assertFalse(model.state.value.hasScreenLock)
    }

    @Test
    fun theSecurityScreenGivesUpFilesWhoseKeysAreDamaged() {
        val (app, folder) = newApp()
        app.crypto.files.wrap("0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff", app.crypto.files.newFileKey())
        damage(File(folder, "file-key"))
        val model = SecurityViewModel(app.crypto, inline)
        model.refresh()
        assertTrue(model.state.value.filesCanBeGivenUp)
        assertFalse("no words can bring a random key back", model.state.value.needsRepair)

        model.onGiveUpFiles()

        assertFalse(model.state.value.filesCanBeGivenUp)
        assertNull(model.state.value.keyId)
    }

    @Test
    fun theSecurityScreenSaysWhenASetupStopped() {
        val (app, folder) = newApp()
        stoppedSetup(app, folder, app.crypto.setup.createRecoveryKey())
        val model = SecurityViewModel(app.crypto, inline)

        model.refresh()

        assertEquals(RecoveryKeyState.UNFINISHED, model.state.value.recoveryKey)
    }

    /** A setup with [key] that stopped just before `record`: its file is gone, the others are stored. */
    private fun stoppedSetup(app: SoftwareKeysApp, folder: File, key: RecoveryKey) {
        app.crypto.setup.storeDerivedKeys(key)
        File(folder, "record").delete()
        assertTrue(app.crypto.status().setupIsUnfinished)
    }
}
