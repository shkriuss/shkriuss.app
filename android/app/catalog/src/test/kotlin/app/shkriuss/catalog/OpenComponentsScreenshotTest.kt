package app.shkriuss.catalog

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import app.shkriuss.core.design.R as DesignR
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureScreenRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshots of the components that open in a window of their own, open,
 * in the eight standard configurations: the dialog, the bottom sheet, the
 * menu, the date picker and the time picker, and the snackbar above its
 * floating action button. Each is opened from "Try it" on its Catalog
 * page, the way a user opens it. The image is the whole screen, with the
 * page dimmed behind the window, so it shows where the window sits and
 * that nothing in it is cut off at font scale 2.0.
 *
 * The pages show every state in place; these check the real windows.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class OpenComponentsScreenshotTest(private val config: ScreenshotConfig) {
    private val compose = createAndroidComposeRule<CatalogActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(config.rule()).around(compose)

    @Test
    fun dialog() {
        open(CatalogPage.Dialogs)
        tapButton(R.string.sample_delete_the_note)
        capture("DialogOpen")
    }

    @Test
    fun bottomSheet() {
        open(CatalogPage.BottomSheets)
        tapButton(R.string.sample_open_sheet)
        capture("BottomSheetOpen")
    }

    @Test
    fun menu() {
        open(CatalogPage.Menus)
        compose.onNode(hasContentDescription(text(DesignR.string.shk_more_options))).performScrollTo().clickWithoutRipple()
        capture("MenuOpen")
    }

    @Test
    fun datePicker() {
        open(CatalogPage.DatePickers)
        tapButton(R.string.sample_choose_due_date)
        capture("DatePickerOpen")
    }

    @Test
    fun timePicker() {
        open(CatalogPage.TimePickers)
        tapButton(R.string.sample_choose_time)
        capture("TimePickerOpen")
    }

    @Test
    fun snackbar() {
        open(CatalogPage.Snackbars)
        // The screen to try is the last thing on the page. At the end of
        // the page it is whole in the window, at font scale 2.0 too.
        compose.onNode(hasScrollAction() and !hasAnyAncestor(hasScrollAction()))
            .performSemanticsAction(SemanticsActions.ScrollBy) { scrollBy -> scrollBy(0f, Float.MAX_VALUE) }
        // A snackbar goes away by itself. The clock stands still from the
        // tap, and moves only far enough for it to appear. TalkBack's tap
        // runs at once, with the clock still.
        compose.mainClock.autoAdvance = false
        compose.onNode(hasContentDescription(text(R.string.sample_new_note)))
            .performSemanticsAction(SemanticsActions.OnClick)
        compose.mainClock.advanceTimeBy(SNACKBAR_APPEARS_MILLIS)
        capture("SnackbarShown")
    }

    private fun open(page: CatalogPage) {
        compose.onNode(hasText(text(page.title))).performScrollTo().performClick()
    }

    /** Taps the button with these words. Under "Try it" it is the last one on the page. */
    private fun tapButton(id: Int) {
        compose.onAllNodes(hasText(text(id)) and hasClickAction()).onLast().performScrollTo().clickWithoutRipple()
    }

    /**
     * Clicks as TalkBack does. A touch would leave the button's pressed
     * ripple on the page behind the window, at a different stage in each
     * run, and the screenshots would differ.
     */
    private fun SemanticsNodeInteraction.clickWithoutRipple() {
        performSemanticsAction(SemanticsActions.OnClick)
        compose.waitForIdle()
    }

    /** The whole screen, every window in it. Roborazzi marks this as experimental. */
    @OptIn(ExperimentalRoborazziApi::class)
    private fun capture(name: String) {
        captureScreenRoboImage("src/test/screenshots/${name}_${config.name}.png")
    }

    private fun text(id: Int): String = compose.activity.getString(id)

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun configs(): List<Array<Any>> = ScreenshotConfig.all().map { arrayOf(it) }

        /** Long enough for a snackbar to fade in, far shorter than it shows. */
        private const val SNACKBAR_APPEARS_MILLIS = 1_000L
    }
}
