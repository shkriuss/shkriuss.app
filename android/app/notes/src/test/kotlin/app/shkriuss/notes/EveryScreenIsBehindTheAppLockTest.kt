package app.shkriuss.notes

import android.content.Intent
import android.os.Looper
import android.os.PowerManager
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import app.shkriuss.core.testing.AppLockCheck
import app.shkriuss.core.testing.TestDocuments
import app.shkriuss.feature.notes.R
import java.util.concurrent.CountDownLatch
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import app.shkriuss.core.design.R as DesignR

/**
 * Every screen of Notes is behind the app lock
 * (docs/architecture/security-screens.md, "Every screen is behind the
 * gate"). A copy of Water's test.
 *
 * With the app lock on and the app locked, it starts every activity of
 * Notes' merged manifest, except the screens of core/security, and fails
 * unless each shows the lock screen and nothing of its own.
 *
 * Then, for each menu and dialog of Notes: it opens it with the app lock
 * on and the app open, turns the screen off so that the app locks, and
 * fails unless only the lock screen shows, in every window.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = LockedNotesApp::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class EveryScreenIsBehindTheAppLockTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun everyScreenShowsTheLockScreenAndNothingOfItsOwn() {
        val checked = AppLockCheck.checkEveryScreen(compose)
        // The merged manifest was read: the launcher screen is among the screens checked.
        assertTrue(checked.toString(), NotesActivity::class.java.name in checked)
    }

    @Test
    @Config(application = AppLockOnNotesApp::class)
    fun theMenuOfANoteGoesWhenTheAppLocks() {
        seed { addNote("Trip", "Passport") }
        openThenLock {
            openTrip()
            compose.tap(hasContentDescription(words(DesignR.string.shk_more_options)))
        }
    }

    @Test
    @Config(application = AppLockOnNotesApp::class)
    fun theMenuOfAFileGoesWhenTheAppLocks() {
        val trip = seed { addNote("Trip", "Passport") }
        openThenLock {
            compose.addFiles(trip, BytesPick("plan.pdf", "application/pdf", ByteArray(FILE_BYTES)))
            openTrip()
            compose.tap(rowMatcher("plan.pdf"))
        }
    }

    @Test
    @Config(application = AppLockOnNotesApp::class)
    fun theMenuOfTheImageViewGoesWhenTheAppLocks() {
        val trip = seed { addNote("Trip", "Passport") }
        openThenLock {
            compose.addFiles(trip, BytesPick("ticket.png", "image/png", pngBytes()))
            openTrip()
            compose.waitFor(hasContentDescription("ticket.png, image", substring = true))
            compose.tap(rowMatcher("ticket.png"))
            compose.tap(hasContentDescription(words(DesignR.string.shk_more_options)))
        }
    }

    @Test
    @Config(application = AppLockOnNotesApp::class)
    fun theQuestionWhenANoteIsNotSavedGoesWhenTheAppLocks() {
        seed { addNote("Trip", "Passport") }
        openThenLock {
            openTrip()
            refuseWrites()
            compose.editor("Passport").performTextInput("Tickets ")
            compose.waitForText(words(R.string.notes_save_failed))
            compose.tap(R.string.notes_settings)
            compose.waitFor(isDialog())
        }
    }

    @Test
    @Config(application = AppLockOnNotesApp::class)
    fun theDialogOfSavingACopyGoesWhenTheAppLocks() {
        val trip = seed { addNote("Trip", "Passport") }
        pickerDocuments()
        val hold = CountDownLatch(1)
        try {
            openThenLock { scenario ->
                compose.addFiles(trip, BytesPick("plan.pdf", "application/pdf", ByteArray(FILE_BYTES)))
                openTrip()
                compose.runAction(rowMatcher("plan.pdf"), words(R.string.notes_save_copy))
                compose.waitForOpened(scenario) { it.action == Intent.ACTION_CREATE_DOCUMENT }
                TestDocuments.onOpen = { hold.await() }
                compose.theOpenedScreenCloses(scenario, TestDocuments.uri("plan.pdf"))
                compose.waitForText(words(R.string.notes_saving_copy))
            }
        } finally {
            hold.countDown()
            TestDocuments.onOpen = {}
        }
    }

    private fun openTrip() {
        compose.tap(rowMatcher("Trip"))
        compose.waitFor(IS_EDITABLE and hasText("Trip"))
    }

    /**
     * Starts Notes with the app open, waits until the list shows, does
     * [open], checks that something opened in a window of its own, turns
     * the screen off so that the app locks, and checks that only the lock
     * screen shows.
     */
    private fun openThenLock(open: (ActivityScenario<NotesActivity>) -> Unit) {
        use24HourClock()
        ActivityScenario.launch(NotesActivity::class.java).use { scenario ->
            compose.waitFor(hasContentDescription(words(R.string.notes_new_note)) or hasText(words(R.string.notes_new_note)))
            val windowsBefore = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
            open(scenario)
            compose.waitForIdle()
            val windows = compose.onAllNodes(isRoot()).fetchSemanticsNodes().size
            assertTrue("A dialog or a menu opened in a window of its own", windows > windowsBefore)

            val app = ApplicationProvider.getApplicationContext<AppLockOnNotesApp>()
            shadowOf(app.getSystemService(PowerManager::class.java)).turnScreenOn(false)
            app.sendBroadcast(Intent(Intent.ACTION_SCREEN_OFF))
            shadowOf(Looper.getMainLooper()).idle()

            AppLockCheck.checkLockedNow(compose, NotesActivity::class.java.name)
        }
    }

    private companion object {
        const val FILE_BYTES = 2_400_000
    }
}
