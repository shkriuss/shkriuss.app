package app.shkriuss.reminders

import android.app.Application
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
import androidx.test.core.app.ApplicationProvider
import app.shkriuss.feature.reminders.ClockReading
import app.shkriuss.feature.reminders.Reminder
import app.shkriuss.feature.reminders.RemindersRepository
import app.shkriuss.feature.reminders.Schedule
import java.time.LocalDateTime
import java.time.ZoneOffset
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/** The app class of the test. */
val testApp: RemindersTestApp
    get() = ApplicationProvider.getApplicationContext<Application>() as RemindersTestApp

/** The words of string [id] of the app, with [args]. */
fun words(@StringRes id: Int, vararg args: Any): String =
    ApplicationProvider.getApplicationContext<Application>().getString(id, *args)

/** Writes what a test starts with, before the screen starts, as the user would have. */
fun seed(write: suspend RemindersRepository.() -> Unit) = runBlocking { testApp.test.services.repository.write() }

/**
 * Adds a reminder as the form would have, saved at [savedAt], local time,
 * which is UTC in the tests. A one-time reminder saved after its time is
 * past.
 */
suspend fun RemindersRepository.addSaved(title: String, schedule: Schedule, savedAt: LocalDateTime = THE_TIME): Reminder =
    checkNotNull(add(title, schedule, ClockReading(savedAt.toInstant(ZoneOffset.UTC).toEpochMilli(), ZoneOffset.UTC)))

/** The reminders that are not deleted, as the database holds them now. */
fun storedReminders(): List<Reminder> = runBlocking { testApp.test.services.repository.reminders().first() }

/** The phone's "Use 24-hour format", as in the spec's examples: "09:00". */
fun use24HourClock() {
    Settings.System.putString(ApplicationProvider.getApplicationContext<Application>().contentResolver, Settings.System.TIME_12_24, "24")
}

/** Waits up to five seconds, for the database, until something matches [matcher]. */
fun ComposeTestRule.waitFor(matcher: SemanticsMatcher) {
    waitUntil(WAIT_MILLIS) { onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
}

/** Waits until nothing matches [matcher] any more, as a sheet that slides down. */
fun ComposeTestRule.waitForGone(matcher: SemanticsMatcher) {
    waitUntil(WAIT_MILLIS) { onAllNodes(matcher).fetchSemanticsNodes().isEmpty() }
}

/** A field whose error, which TalkBack announces, is [text]. The text under the field is not read as well. */
fun hasError(text: String): SemanticsMatcher = SemanticsMatcher.expectValue(SemanticsProperties.Error, text)

/** Waits until something shows [text]. */
fun ComposeTestRule.waitForText(text: String, substring: Boolean = false) = waitFor(hasText(text, substring = substring))

/**
 * Taps the one thing that can be tapped and shows [text], or is labelled
 * [text] for TalkBack, as an icon button is, as TalkBack does: also below
 * the edge of the window, and without a ripple, which would differ from
 * one run to the next in a screenshot.
 *
 * It first waits for that thing to show. A screen draws what it reads
 * from the database only once Room's thread has answered, and Compose
 * does not wait for that thread by itself.
 */
fun ComposeTestRule.tap(text: String, substring: Boolean = false) =
    tap(hasText(text, substring = substring) or hasContentDescription(text, substring = substring))

/** Taps the one thing that can be tapped with the words of string [id]. */
fun ComposeTestRule.tap(@StringRes id: Int) = tap(words(id))

/** Taps the one thing that can be tapped and matches [matcher], once it shows. */
fun ComposeTestRule.tap(matcher: SemanticsMatcher) {
    val target = matcher and hasClickAction()
    waitFor(target)
    onNode(target).tapAsTalkBack()
    waitForIdle()
}

/** A tap as TalkBack makes it. */
fun SemanticsNodeInteraction.tapAsTalkBack(): SemanticsNodeInteraction = performSemanticsAction(SemanticsActions.OnClick)

/** The text field labelled [label]. */
fun ComposeTestRule.field(label: String): SemanticsNodeInteraction =
    onNode(hasText(label) and SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText))

private const val WAIT_MILLIS = 5_000L
