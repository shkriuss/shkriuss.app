package app.shkriuss.tasks

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
import app.shkriuss.feature.tasks.Due
import app.shkriuss.feature.tasks.INBOX
import app.shkriuss.feature.tasks.NewTask
import app.shkriuss.feature.tasks.Task
import app.shkriuss.feature.tasks.TaskList
import app.shkriuss.feature.tasks.TasksRepository
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

/** The app class of the test. */
val testApp: TasksTestApp
    get() = ApplicationProvider.getApplicationContext<Application>() as TasksTestApp

/** The words of string [id] of the app, with [args]. */
fun words(@StringRes id: Int, vararg args: Any): String =
    ApplicationProvider.getApplicationContext<Application>().getString(id, *args)

/** Writes what a test starts with, before the screen starts, as the user would have. */
fun <T> seed(write: suspend TasksRepository.() -> T): T = runBlocking { testApp.test.services.repository.write() }

/** Adds a task as the form would have, at the test's clock. */
suspend fun TasksRepository.addTask(title: String, due: Due? = null, listId: String = INBOX): Task =
    checkNotNull(addTask(NewTask(title, listId, due)))

/** Adds a list as New list would have. */
suspend fun TasksRepository.addAList(name: String): TaskList = checkNotNull(addList(name))

/** The tasks that are not deleted, as the database holds them now. */
fun storedTasks(): List<Task> = runBlocking { testApp.test.services.repository.tasks().first() }

/** The lists that are not deleted, as the database holds them now. */
fun storedLists(): List<TaskList> = runBlocking { testApp.test.services.repository.lists().first() }

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

/**
 * The row of the task or list [name], as TalkBack reads it: the one item
 * that holds [name] and offers a tap, not a text field, and not a tick
 * box, which TalkBack skips.
 */
fun ComposeTestRule.row(name: String): SemanticsNodeInteraction = onNode(rowMatcher(name))

/** What [row] finds. */
fun rowMatcher(name: String): SemanticsMatcher =
    hasText(name) and hasClickAction() and
        !SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText) and
        !SemanticsMatcher.keyIsDefined(SemanticsProperties.HideFromAccessibility)

/** Ticks the task [title], or clears its tick, as TalkBack does: by the row's action, "Mark as done" or "Mark as not done". */
fun ComposeTestRule.tick(title: String, @StringRes action: Int) {
    waitFor(hasText(title) and hasClickAction())
    val node = row(title).fetchSemanticsNode()
    val label = words(action)
    val actions = node.config[SemanticsActions.CustomActions]
    check(actions.any { it.label == label }) { "$title offers ${actions.map { it.label }}, not $label" }
    runOnUiThread { actions.single { it.label == label }.action() }
    waitForIdle()
}

private const val WAIT_MILLIS = 5_000L
