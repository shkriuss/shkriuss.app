package app.shkriuss.catalog

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasParent
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.isNotEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.toSize
import app.shkriuss.core.design.ShkSpacing
import org.junit.Assert.assertEquals
import app.shkriuss.core.design.R as DesignR
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Opens each component page the way a user does and checks the components
 * on it as they are laid out there: what TalkBack hears, that touch
 * targets do not overlap, that every state is shown, and that the
 * components under "Try it" respond. Graphics run natively, so text is
 * measured with the real font.
 *
 * How each component behaves on its own is checked in `core/design`, by
 * `ShkComponentsTest`.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ComponentPagesTest {
    @get:Rule
    val compose = createAndroidComposeRule<CatalogActivity>()

    @Test
    fun everyComponentHasALabelARoleAndATouchTargetOfItsOwn() {
        COMPONENT_PAGES.forEach { page ->
            open(page)
            val components = compose.onAllNodes(IS_COMPONENT).fetchSemanticsNodes()
            assertTrue("${page.name} shows no components", components.size > 1)
            components.forEach { node ->
                val label = node.config.getOrElse(SemanticsProperties.ContentDescription) { emptyList() } +
                    node.config.getOrElse(SemanticsProperties.Text) { emptyList() }.map { it.text }
                assertTrue("${page.name}: a component has no label for TalkBack", label.any { it.isNotBlank() })
                // TalkBack calls a text field an edit box and a slider a
                // slider from what they are; everything else needs a role.
                val kind = SemanticsProperties.Role in node.config ||
                    SemanticsProperties.EditableText in node.config ||
                    SemanticsProperties.ProgressBarRangeInfo in node.config
                assertTrue("${page.name}: ${label.joinToString()} has no role for TalkBack", kind)
            }
            val targets = components.map { touchTarget(it) }
            targets.forEachIndexed { index, target ->
                targets.drop(index + 1).forEach { other ->
                    assertFalse("${page.name}: two touch targets overlap, $target and $other", target.overlaps(other))
                }
            }
            back()
        }
    }

    @Test
    fun everyComponentThatCanBeTurnedOffIsShownTurnedOff() {
        // Buttons: filled, tonal, text and icon. Chips: two filter chips and
        // one assist chip. Floating action buttons have no disabled state.
        // Selection controls: two each of checkbox, switch and radio button,
        // off and on. Lists: one list item. Cards, and the buttons of the
        // empty and error states, have no disabled state. Top bars: one
        // action. Destinations and the list and detail have none.
        val expected = mapOf(
            CatalogPage.Buttons to 4,
            CatalogPage.FloatingActionButtons to 0,
            CatalogPage.Chips to 3,
            CatalogPage.TextFields to 1,
            CatalogPage.SelectionControls to 6,
            CatalogPage.Sliders to 1,
            CatalogPage.Cards to 0,
            CatalogPage.Lists to 1,
            CatalogPage.ContentStates to 0,
            CatalogPage.TopBars to 1,
            CatalogPage.Navigation to 0,
            CatalogPage.ListDetail to 0,
        )
        assertEquals("every component page is checked", COMPONENT_PAGES.toSet(), expected.keys)
        expected.forEach { (page, count) ->
            open(page)
            val disabled = compose.onAllNodes(IS_COMPONENT and isNotEnabled()).fetchSemanticsNodes()
            assertEquals("disabled components on ${page.name}", count, disabled.size)
            back()
        }
    }

    @Test
    fun filterChipsToTrySelectAndClear() {
        open(CatalogPage.Chips)
        // "Done" is only under "Try it".
        compose.onNode(hasText(compose.activity.getString(R.string.sample_done)) and hasClickAction())
            .performScrollTo()
            .assertIsNotSelected()
            .performClick()
            .assertIsSelected()
            .performClick()
            .assertIsNotSelected()
    }

    @Test
    fun checkboxesAndSwitchesToTryTurnOnAndOff() {
        open(CatalogPage.SelectionControls)
        // "Repeat every week" and "Sound" are only under "Try it".
        listOf(R.string.sample_repeat_weekly, R.string.sample_sound).forEach { id ->
            compose.onNode(hasText(text(id)) and hasClickAction())
                .performScrollTo()
                .assertIsOff()
                .performClick()
                .assertIsOn()
                .performClick()
                .assertIsOff()
        }
    }

    @Test
    fun radioButtonsToTrySelectOneAndClearTheOthers() {
        open(CatalogPage.SelectionControls)
        fun option(id: Int) = compose.onNode(hasText(text(id)) and hasClickAction() and hasParent(IS_GROUP))

        option(R.string.sample_millilitres).performScrollTo().assertIsSelected()
        option(R.string.sample_cups).performScrollTo().assertIsNotSelected().performClick().assertIsSelected()
        option(R.string.sample_millilitres).assertIsNotSelected()
        option(R.string.sample_ounces).assertIsNotSelected()
    }

    @Test
    fun textFieldToTryTakesTypingAndShowsItsError() {
        open(CatalogPage.TextFields)
        // Only the field to try has this help, and no other field holds "Tamar".
        compose.onNode(IS_TEXT_FIELD and hasText(text(R.string.sample_name_limit)))
            .performScrollTo()
            .performTextInput("Tamar")
        val field = compose.onNode(IS_TEXT_FIELD and hasText("Tamar", substring = true))
        field.assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.Error))

        field.performTextInput(" and a name that is too long")
        field.assert(SemanticsMatcher.expectValue(SemanticsProperties.Error, text(R.string.sample_name_too_long)))
    }

    @Test
    fun sliderToTryMovesAndSaysItsValue() {
        open(CatalogPage.Sliders)
        // The slider to try is the last one on the page.
        val slider = compose.onAllNodes(IS_SLIDER).onLast().performScrollTo()
        slider.performSemanticsAction(SemanticsActions.SetProgress) { setProgress -> setProgress(3f) }

        val three = compose.activity.resources.getQuantityString(R.plurals.sample_glasses, 3, 3)
        slider.assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, three))
    }

    @Test
    fun sectionHeadersAreHeadingsAndTheLoadingStateIsReadWithItsText() {
        open(CatalogPage.Lists)
        // "Tomorrow" is only a section header.
        compose.onNode(hasText(text(R.string.sample_tomorrow))).performScrollTo().assert(isHeading())
        back()

        open(CatalogPage.ContentStates)
        val inProgress = SemanticsMatcher.expectValue(
            SemanticsProperties.ProgressBarRangeInfo,
            ProgressBarRangeInfo.Indeterminate,
        )
        compose.onNode(hasText(text(R.string.sample_loading_notes))).performScrollTo().assert(inProgress)
    }

    @Test
    fun onlyTheEmptyStateThatAnswersASearchIsAnnounced() {
        open(CatalogPage.ContentStates)
        // "No results" answers a search, so it is announced. "No notes yet"
        // is what a screen shows when it opens, so it is not.
        val polite = SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)
        compose.onNode(hasText(text(R.string.sample_no_results))).performScrollTo().assert(polite)
        compose.onNode(hasText(text(R.string.sample_no_notes)))
            .performScrollTo()
            .assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.LiveRegion))
    }

    @Test
    fun statesToTrySwapAndAreAnnouncedPolitely() {
        open(CatalogPage.ContentStates)
        // These words are only under "Try it".
        val error = hasText(text(R.string.sample_try_error))
        val loading = hasText(text(R.string.sample_try_loading))
        val polite = SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite)
        compose.onNode(error).performScrollTo().assert(polite)
        compose.onAllNodes(loading).assertCountEquals(0)

        // "Try again" is on three error states; the one to try is the last.
        compose.onAllNodes(hasText(text(R.string.sample_try_again)) and hasClickAction())
            .onLast()
            .performScrollTo()
            .performClick()
        compose.onNode(loading).assert(polite)
        compose.onAllNodes(error).assertCountEquals(0)

        compose.onNode(hasText(text(R.string.sample_show_loading)) and hasClickAction())
            .performScrollTo()
            .assertIsOn()
            .performClick()
        compose.onNode(error).assert(polite)
    }

    @Test
    fun navigationToTrySelectsTheDestinationTapped() {
        open(CatalogPage.Navigation)
        val search = text(R.string.sample_search)
        // The one to try is the last sample on the page. The others show
        // the first destination, Today, as their title.
        compose.onAllNodes(hasText(search) and isHeading()).assertCountEquals(0)
        compose.onAllNodes(hasText(search) and hasClickAction())
            .onLast()
            .performScrollTo()
            .assertIsNotSelected()
            .performClick()
            .assertIsSelected()
        compose.onAllNodes(hasText(search) and isHeading()).assertCountEquals(1)
    }

    @Test
    fun listAndDetailToTryOpensANoteAndBackReturnsToTheList() {
        open(CatalogPage.ListDetail)
        // Only the one to try opens "Call the dentist". It is the last
        // sample on the page, and the test window is narrow: one pane.
        val dentist = text(R.string.sample_call_dentist)
        val openNote = hasText(dentist) and isHeading()
        fun openTheNote() {
            compose.onAllNodes(hasText(dentist) and hasClickAction()).onLast().scrollPageTo().performClick()
            compose.onNode(openNote).assertExists()
        }
        compose.onAllNodes(openNote).assertCountEquals(0)

        // The back gesture closes the note, and leaves the page open.
        openTheNote()
        back()
        compose.onAllNodes(openNote).assertCountEquals(0)
        compose.onNode(hasText(text(R.string.page_list_detail_title)) and isHeading()).assertExists()

        // Back in the note's top bar closes it too. The one to try is last.
        openTheNote()
        compose.onAllNodes(hasContentDescription(text(DesignR.string.shk_back))).onLast().performClick()
        compose.onAllNodes(openNote).assertCountEquals(0)
    }

    private fun text(id: Int): String = compose.activity.getString(id)

    private fun open(page: CatalogPage) {
        compose.onNode(hasText(compose.activity.getString(page.title))).performScrollTo().performClick()
    }

    private fun back() {
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
    }

    /**
     * Scrolls the page until this node is a third of the way down the
     * window. `performScrollTo` scrolls only the closest part that
     * scrolls, which for a node in a sample that scrolls inside the page,
     * such as a pane of a list and detail, is the sample, not the page.
     */
    private fun SemanticsNodeInteraction.scrollPageTo(): SemanticsNodeInteraction {
        val page = compose.onNode(hasScrollAction() and !hasAnyAncestor(hasScrollAction()))
        val window = page.fetchSemanticsNode()
        val offset = fetchSemanticsNode().positionInRoot.y - window.positionInRoot.y - window.size.height / 3f
        page.performSemanticsAction(SemanticsActions.ScrollBy) { scrollBy -> scrollBy(0f, offset) }
        compose.waitForIdle()
        return this
    }

    /**
     * The area a touch on [node] lands in: the component as drawn, grown
     * to at least 48 by 48 dp around its centre, as Android does. Measured
     * unclipped, so components below the window count too.
     */
    private fun touchTarget(node: SemanticsNode): Rect {
        val drawn = Rect(node.positionInRoot, node.size.toSize())
        val minimum = with(compose.density) { ShkSpacing.MinTouchTarget.toPx() }
        val width = maxOf(drawn.width, minimum)
        val height = maxOf(drawn.height, minimum)
        return Rect(
            left = drawn.center.x - width / 2,
            top = drawn.center.y - height / 2,
            right = drawn.center.x + width / 2,
            bottom = drawn.center.y + height / 2,
        )
    }

    private companion object {
        val COMPONENT_PAGES = CatalogPage.entries.filter { it.group == CatalogGroup.Components }

        val IS_TEXT_FIELD = SemanticsMatcher.keyIsDefined(SemanticsProperties.EditableText)
        val IS_SLIDER = SemanticsMatcher.keyIsDefined(SemanticsActions.SetProgress)
        val IS_GROUP = SemanticsMatcher.keyIsDefined(SemanticsProperties.SelectableGroup)

        /**
         * Anything the user acts on: what is tapped (buttons, chips and the
         * rows of selection controls), text fields and sliders.
         */
        val IS_COMPONENT = hasClickAction() or IS_TEXT_FIELD or IS_SLIDER
    }
}
