package app.shkriuss.catalog

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshots of the Catalog start screen and of every page, token pages
 * and component pages, in the eight standard configurations. The reference images are in
 * `src/test/screenshots/`. A page taller than the window gets one image
 * per window, to its end ([captureWholeScreen]).
 *
 * The test starts the real activity, so the images show the window theme
 * and the system bar insets too. The screen is set up before the activity
 * starts, and the Compose rule waits until drawing is done. Pages are
 * opened the way a user opens them, by tapping their button.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CatalogScreenScreenshotTest(private val config: ScreenshotConfig) {
    private val compose = createAndroidComposeRule<CatalogActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(config.rule()).around(compose)

    @Test
    fun catalogScreen() {
        compose.captureWholeScreen("CatalogScreen", config)
    }

    @Test
    fun colorsPage() {
        captureWholePage(CatalogPage.Colors, "ColorsPage")
    }

    @Test
    fun typePage() {
        captureWholePage(CatalogPage.Type, "TypePage")
    }

    @Test
    fun shapePage() {
        captureWholePage(CatalogPage.Shape, "ShapePage")
    }

    @Test
    fun spacingPage() {
        captureWholePage(CatalogPage.Spacing, "SpacingPage")
    }

    @Test
    fun buttonsPage() {
        captureWholePage(CatalogPage.Buttons, "ButtonsPage")
    }

    @Test
    fun floatingActionButtonsPage() {
        captureWholePage(CatalogPage.FloatingActionButtons, "FloatingActionButtonsPage")
    }

    @Test
    fun chipsPage() {
        captureWholePage(CatalogPage.Chips, "ChipsPage")
    }

    @Test
    fun textFieldsPage() {
        captureWholePage(CatalogPage.TextFields, "TextFieldsPage")
    }

    @Test
    fun selectionControlsPage() {
        captureWholePage(CatalogPage.SelectionControls, "SelectionControlsPage")
    }

    @Test
    fun slidersPage() {
        captureWholePage(CatalogPage.Sliders, "SlidersPage")
    }

    @Test
    fun cardsPage() {
        captureWholePage(CatalogPage.Cards, "CardsPage")
    }

    @Test
    fun listsPage() {
        captureWholePage(CatalogPage.Lists, "ListsPage")
    }

    @Test
    fun contentStatesPage() {
        captureWholePage(CatalogPage.ContentStates, "ContentStatesPage")
    }

    @Test
    fun topBarsPage() {
        captureWholePage(CatalogPage.TopBars, "TopBarsPage")
    }

    @Test
    fun navigationPage() {
        captureWholePage(CatalogPage.Navigation, "NavigationPage")
    }

    @Test
    fun listDetailPage() {
        captureWholePage(CatalogPage.ListDetail, "ListDetailPage")
    }

    @Test
    fun dialogsPage() {
        captureWholePage(CatalogPage.Dialogs, "DialogsPage")
    }

    @Test
    fun bottomSheetsPage() {
        captureWholePage(CatalogPage.BottomSheets, "BottomSheetsPage")
    }

    @Test
    fun snackbarsPage() {
        captureWholePage(CatalogPage.Snackbars, "SnackbarsPage")
    }

    @Test
    fun menusPage() {
        captureWholePage(CatalogPage.Menus, "MenusPage")
    }

    @Test
    fun datePickersPage() {
        captureWholePage(CatalogPage.DatePickers, "DatePickersPage")
    }

    @Test
    fun timePickersPage() {
        captureWholePage(CatalogPage.TimePickers, "TimePickersPage")
    }

    private fun captureWholePage(page: CatalogPage, name: String) {
        compose.onNode(hasText(compose.activity.getString(page.title))).performScrollTo().performClick()
        compose.captureWholeScreen(name, config)
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun configs(): List<Array<Any>> = ScreenshotConfig.all().map { arrayOf(it) }
    }
}
