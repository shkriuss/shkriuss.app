package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Checks [ShkMenu] and the menu of a [ShkTopBar] at font scale 1.0 and
 * 2.0, for the rules in CLAUDE.md, "UI and accessibility":
 *
 * - Each row is read once, by its text, as a button, and is at least
 *   48dp tall. Its icon is not read.
 * - A tap on a row closes the menu, then calls the row. A row turned off
 *   is read as disabled and ignores taps.
 * - Long text wraps inside the menu's 280dp and is not cut.
 * - The top bar's "More options" button is read by its label and opens
 *   the menu.
 *
 * The screen is the screenshot phone. Graphics run natively, so text is
 * measured with the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(qualifiers = "w411dp-h914dp")
class ShkMenuTest(private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun everyRowIsReadOnceAsAButtonAndItsIconIsNot() {
        show {
            Box {
                ShkMenu(
                    expanded = true,
                    onDismissRequest = {},
                    items = listOf(
                        ShkMenuItem(text = RENAME, onClick = {}, icon = BlankIcon()),
                        ShkMenuItem(text = DELETE, onClick = {}, destructive = true),
                    ),
                )
            }
        }

        listOf(RENAME, DELETE).forEach { text ->
            compose.onAllNodes(hasText(text), useUnmergedTree = true).assertCountEquals(1)
            compose.onNode(hasText(text))
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
                .assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.ContentDescription))
                .assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)
        }
    }

    @Test
    fun aTapOnARowClosesTheMenuThenCallsIt() {
        val calls = mutableListOf<String>()
        show {
            Box {
                ShkMenu(
                    expanded = true,
                    onDismissRequest = { calls += CLOSED },
                    items = listOf(
                        ShkMenuItem(text = RENAME, onClick = { calls += RENAME }),
                        ShkMenuItem(text = DUPLICATE, onClick = { calls += DUPLICATE }, enabled = false),
                    ),
                )
            }
        }

        compose.onNode(hasText(DUPLICATE)).assertIsNotEnabled().performClick()
        compose.runOnIdle { assertTrue("A row turned off does nothing", calls.isEmpty()) }
        compose.onNode(hasText(RENAME)).performClick()
        compose.runOnIdle { assertEquals(listOf(CLOSED, RENAME), calls) }
    }

    @OptIn(ShkInPlace::class)
    @Test
    fun longTextWrapsInsideTheMenu() {
        show {
            ShkMenuInPlace(
                listOf(
                    ShkMenuItem(text = LONG_ROW, onClick = {}, icon = BlankIcon()),
                    ShkMenuItem(text = RENAME, onClick = {}),
                ),
            )
        }

        val row = compose.onNode(hasText(LONG_ROW), useUnmergedTree = true).fetchSemanticsNode()
        val layout = layoutOf(row)
        assertTrue("The long row should wrap in this test", layout.lineCount > 1)
        assertFalse("The long row is cut off by its own layout", layout.hasVisualOverflow)
        val menu = compose.onNode(hasText(LONG_ROW)).fetchSemanticsNode().boundsInRoot
        assertTrue("The menu should be at most 280dp wide", menu.width <= with(compose.density) { MENU_MAX_WIDTH.toPx() } + 1f)
    }

    @Test
    fun theTopBarOpensItsMenuFromMoreOptions() {
        var renamed = 0
        show {
            ShkTopBar(
                title = TITLE,
                menuItems = listOf(ShkMenuItem(text = RENAME, onClick = { renamed++ })),
            )
        }

        compose.onAllNodes(hasText(RENAME)).assertCountEquals(0)
        compose.onAllNodes(hasContentDescription(MORE), useUnmergedTree = true).assertCountEquals(1)
        compose.onNode(hasContentDescription(MORE))
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
            .performClick()
        compose.onNode(hasText(RENAME)).performClick()
        compose.onAllNodes(hasText(RENAME)).assertCountEquals(0)
        compose.runOnIdle { assertEquals("A tap on a row calls it", 1, renamed) }
    }

    /** Draws [content] in the theme. A test calls it once. */
    private fun show(content: @Composable () -> Unit) {
        compose.setContent { ShkTheme { content() } }
    }

    private fun layoutOf(node: SemanticsNode): TextLayoutResult {
        val layouts = mutableListOf<TextLayoutResult>()
        node.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        return layouts.single()
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "font {0}")
        fun parameters(): List<Array<Any>> = listOf(1.0f, 2.0f).map { arrayOf(it) }

        private const val TITLE = "Notes"
        private const val RENAME = "Rename"
        private const val DUPLICATE = "Duplicate"
        private const val DELETE = "Delete"
        private const val CLOSED = "closed"
        private const val MORE = "More options"
        private const val LONG_ROW = "Move the note to another folder, such as Home or Work"

        /** The widest Material 3 lets a menu row be. */
        private val MENU_MAX_WIDTH = 280.dp
    }
}
