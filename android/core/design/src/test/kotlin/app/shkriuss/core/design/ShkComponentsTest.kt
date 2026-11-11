package app.shkriuss.core.design

import android.content.ComponentName
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.GraphicsMode

/**
 * Checks every `Shk*` button, floating action button and chip, at font
 * scale 1.0 and 2.0, for the rules in CLAUDE.md, "UI and accessibility":
 *
 * - the space it takes is at least 48 by 48 dp, so its touch target is,
 * - TalkBack hears its label once, its role, and whether it is turned
 *   off or selected,
 * - long text wraps, is not cut by its own layout, and stays inside the
 *   component's shape, so a round end never cuts a corner of the text.
 *
 * Graphics run natively, so text is measured with the real font.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ShkComponentsTest(private val case: ComponentCase, private val fontScale: Float) {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale)).around(compose)

    @Test
    fun takesA48dpTouchTargetAndTellsTalkBackWhatItIs() {
        var clicks = 0
        compose.setContent {
            ShkTheme {
                Box(Modifier.testTag(TARGET)) { case.content(SHORT_LABEL, true) { clicks++ } }
            }
        }

        compose.onNodeWithTag(TARGET)
            .assertWidthIsAtLeast(ShkSpacing.MinTouchTarget)
            .assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)
        val component = compose.onNode(hasClickAction())
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, case.role))
            .assertIsEnabled()
        val config = component.fetchSemanticsNode().config
        val heard = config.getOrElse(SemanticsProperties.ContentDescription) { emptyList() } +
            config.getOrElse(SemanticsProperties.Text) { emptyList() }.map { it.text }
        assertEquals("$case: TalkBack should hear the label once", listOf(SHORT_LABEL), heard)
        case.selected?.let { selected ->
            component.assert(SemanticsMatcher.expectValue(SemanticsProperties.Selected, selected))
        }
        component.performClick()
        compose.runOnIdle { assertEquals(1, clicks) }
    }

    @Test
    fun turnedOffItTellsTalkBackAndIgnoresTaps() {
        assumeTrue("$case has no disabled state", case.canBeDisabled)
        var clicks = 0
        compose.setContent {
            ShkTheme { case.content(SHORT_LABEL, false) { clicks++ } }
        }

        compose.onNode(hasClickAction()).assertIsNotEnabled().performClick()
        compose.runOnIdle { assertEquals(0, clicks) }
    }

    @Test
    fun longTextWrapsInsideTheShape() {
        assumeTrue("$case shows no text", case.showsText)
        compose.setContent {
            ShkTheme {
                Box(Modifier.width(NARROW_WIDTH)) { case.content(LONG_LABEL, true) {} }
            }
        }

        val component = compose.onNode(hasClickAction()).fetchSemanticsNode()
        val text = compose.onNode(hasText(LONG_LABEL), useUnmergedTree = true).fetchSemanticsNode()
        val layouts = mutableListOf<TextLayoutResult>()
        text.config[SemanticsActions.GetTextLayoutResult].action?.invoke(layouts)
        val layout = layouts.single()
        assertTrue("$case: the long text should wrap in this test", layout.lineCount > 1)
        assertFalse("$case: the text is cut off by its own layout", layout.hasVisualOverflow)

        val bounds = component.boundsInRoot
        val outline = case.shape.createOutline(bounds.size, LayoutDirection.Ltr, compose.density)
        val textBox = text.boundsInRoot.translate(-bounds.topLeft)
        textBox.corners().forEach { corner ->
            assertTrue(
                "$case: the corner $corner of the text, ${textBox.size}, is outside the shape, ${bounds.size}",
                outline.contains(corner),
            )
        }
    }

    /**
     * One component as the tests see it. [content] draws it with a label,
     * turned on or off, calling the click handler it is given.
     */
    class ComponentCase(
        private val name: String,
        /** What TalkBack calls it. */
        val role: Role,
        /** The shape it is drawn in, to check that text stays inside. */
        val shape: Shape,
        /** False for icon-only components, whose label is a content description. */
        val showsText: Boolean = true,
        /** False for floating action buttons, which have no disabled state. */
        val canBeDisabled: Boolean = true,
        /** For chips that can be selected: whether this one is. */
        val selected: Boolean? = null,
        val content: @Composable (label: String, enabled: Boolean, onClick: () -> Unit) -> Unit,
    ) {
        override fun toString(): String = name
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}, font {1}")
        fun parameters(): List<Array<Any>> =
            CASES.flatMap { case -> listOf(1.0f, 2.0f).map { arrayOf(case, it) } }

        private const val TARGET = "component"
        private const val SHORT_LABEL = "Save"
        private const val LONG_LABEL = "Save the changes and go back to the list"

        /** Narrower than any phone, so long text wraps at every font scale. */
        private val NARROW_WIDTH = 200.dp

        private val CASES = listOf(
            ComponentCase("FilledButton", Role.Button, ButtonShape) { label, enabled, onClick ->
                ShkFilledButton(text = label, onClick = onClick, enabled = enabled)
            },
            ComponentCase("FilledButtonWithIcon", Role.Button, ButtonShape) { label, enabled, onClick ->
                ShkFilledButton(text = label, onClick = onClick, enabled = enabled, icon = testIcon())
            },
            ComponentCase("TonalButton", Role.Button, ButtonShape) { label, enabled, onClick ->
                ShkTonalButton(text = label, onClick = onClick, enabled = enabled)
            },
            ComponentCase("TonalButtonWithIcon", Role.Button, ButtonShape) { label, enabled, onClick ->
                ShkTonalButton(text = label, onClick = onClick, enabled = enabled, icon = testIcon())
            },
            ComponentCase("TextButton", Role.Button, ButtonShape) { label, enabled, onClick ->
                ShkTextButton(text = label, onClick = onClick, enabled = enabled)
            },
            ComponentCase("TextButtonWithIcon", Role.Button, ButtonShape) { label, enabled, onClick ->
                ShkTextButton(text = label, onClick = onClick, enabled = enabled, icon = testIcon())
            },
            ComponentCase("IconButton", Role.Button, ShkShapes.Pill, showsText = false) { label, enabled, onClick ->
                ShkIconButton(icon = testIcon(), contentDescription = label, onClick = onClick, enabled = enabled)
            },
            ComponentCase(
                "FloatingActionButton",
                Role.Button,
                ShkShapes.Card,
                showsText = false,
                canBeDisabled = false,
            ) { label, _, onClick ->
                ShkFloatingActionButton(icon = testIcon(), contentDescription = label, onClick = onClick)
            },
            ComponentCase(
                "ExtendedFloatingActionButton",
                Role.Button,
                ShkShapes.Card,
                canBeDisabled = false,
            ) { label, _, onClick ->
                ShkExtendedFloatingActionButton(text = label, icon = testIcon(), onClick = onClick)
            },
            ComponentCase(
                "CollapsedExtendedFloatingActionButton",
                Role.Button,
                ShkShapes.Card,
                showsText = false,
                canBeDisabled = false,
            ) { label, _, onClick ->
                ShkExtendedFloatingActionButton(text = label, icon = testIcon(), onClick = onClick, expanded = false)
            },
            ComponentCase("FilterChip", Role.Checkbox, ChipShape, selected = false) { label, enabled, onClick ->
                ShkFilterChip(text = label, selected = false, onClick = onClick, enabled = enabled)
            },
            ComponentCase("SelectedFilterChip", Role.Checkbox, ChipShape, selected = true) { label, enabled, onClick ->
                ShkFilterChip(text = label, selected = true, onClick = onClick, enabled = enabled)
            },
            ComponentCase("AssistChip", Role.Button, ChipShape) { label, enabled, onClick ->
                ShkAssistChip(text = label, onClick = onClick, enabled = enabled)
            },
            ComponentCase("AssistChipWithIcon", Role.Button, ChipShape) { label, enabled, onClick ->
                ShkAssistChip(text = label, onClick = onClick, enabled = enabled, icon = testIcon())
            },
        )
    }
}

/**
 * Sets the font scale, and lets Robolectric start a plain
 * [ComponentActivity], which no manifest of this library declares. Put it
 * outside the Compose rule, so both are ready before the activity starts.
 */
private class TestActivitySetUp(private val fontScale: Float) : ExternalResource() {
    override fun before() {
        RuntimeEnvironment.setFontScale(fontScale)
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app.packageManager).addActivityIfNotPresent(ComponentName(app, ComponentActivity::class.java))
    }
}

/** Any icon will do. The check mark is the one icon this module has. */
@Composable
private fun testIcon() = painterResource(R.drawable.shk_icon_check)

private fun Rect.corners(): List<Offset> = listOf(topLeft, topRight, bottomLeft, bottomRight)

private fun Outline.contains(point: Offset): Boolean = when (this) {
    is Outline.Rectangle -> rect.contains(point)
    is Outline.Rounded -> roundRect.contains(point)
    is Outline.Generic -> error("Components are drawn in rounded rectangles, not paths")
}
