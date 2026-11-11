package app.shkriuss.catalog

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isNotEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.toSize
import app.shkriuss.core.design.ShkSpacing
import org.junit.Assert.assertEquals
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
 * targets do not overlap, that every state is shown, and that the filter
 * chips to try respond. Graphics run natively, so text is measured with
 * the real font.
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
            val components = compose.onAllNodes(hasClickAction()).fetchSemanticsNodes()
            assertTrue("${page.name} shows no components", components.size > 1)
            components.forEach { node ->
                val label = node.config.getOrElse(SemanticsProperties.ContentDescription) { emptyList() } +
                    node.config.getOrElse(SemanticsProperties.Text) { emptyList() }.map { it.text }
                assertTrue("${page.name}: a component has no label for TalkBack", label.any { it.isNotBlank() })
                assertTrue(
                    "${page.name}: ${label.joinToString()} has no role for TalkBack",
                    SemanticsProperties.Role in node.config,
                )
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
        val expected = mapOf(
            CatalogPage.Buttons to 4,
            CatalogPage.FloatingActionButtons to 0,
            CatalogPage.Chips to 3,
        )
        expected.forEach { (page, count) ->
            open(page)
            val disabled = compose.onAllNodes(hasClickAction() and isNotEnabled()).fetchSemanticsNodes()
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

    private fun open(page: CatalogPage) {
        compose.onNode(hasText(compose.activity.getString(page.title))).performScrollTo().performClick()
    }

    private fun back() {
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
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
    }
}
