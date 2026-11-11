package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.state.ToggleableState
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.GraphicsMode

/**
 * Checks every `Shk*` button, floating action button, chip, checkbox,
 * switch and radio button, the card and list item that can be tapped, and
 * the buttons of the empty and error states, at font scale 1.0 and 2.0,
 * for the rules in CLAUDE.md, "UI and accessibility":
 *
 * - the space it takes is at least 48 by 48 dp, so its touch target is,
 * - TalkBack hears its label once, its role, and whether it is turned
 *   off, selected, or on,
 * - long text wraps, is not cut by its own layout, and stays inside the
 *   component's shape, so a round end never cuts a corner of the text,
 * - an icon next to text grows with the font size, and an icon alone
 *   keeps its size.
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
                Box(Modifier.testTag(TARGET)) { case.content(SHORT_LABEL, true, { clicks++ }, SizeRecordingPainter()) }
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
        case.toggleableState?.let { state ->
            component.assert(SemanticsMatcher.expectValue(SemanticsProperties.ToggleableState, state))
        }
        component.performClick()
        compose.runOnIdle { assertEquals(1, clicks) }
    }

    @Test
    fun turnedOffItTellsTalkBackAndIgnoresTaps() {
        assumeTrue("$case has no disabled state", case.canBeDisabled)
        var clicks = 0
        compose.setContent {
            ShkTheme { case.content(SHORT_LABEL, false, { clicks++ }, SizeRecordingPainter()) }
        }

        compose.onNode(hasClickAction()).assertIsNotEnabled().performClick()
        compose.runOnIdle { assertEquals(0, clicks) }
    }

    @Test
    fun longTextWrapsInsideTheShape() {
        assumeTrue("$case shows no text", case.showsText)
        compose.setContent {
            ShkTheme {
                Box(Modifier.width(NARROW_WIDTH)) { case.content(LONG_LABEL, true, {}, SizeRecordingPainter()) }
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

    @Test
    fun iconNextToTextGrowsWithTheFontSizeAndAnIconAloneDoesNot() {
        val icon = case.icon
        assumeTrue("$case draws no icon it is given", icon != null)
        checkNotNull(icon)
        val painter = SizeRecordingPainter()
        compose.setContent {
            ShkTheme { case.content(SHORT_LABEL, true, {}, painter) }
        }
        compose.waitForIdle()

        val drawn = with(compose.density) { painter.drawnSize.width.toDp() }
        val growing = icon.nextToText && fontScale > 1f
        if (growing) {
            assertTrue("$case: the icon should grow at font scale $fontScale, but is $drawn", drawn > icon.size + 1.dp)
            assertTrue("$case: the icon grew more than the font scale, to $drawn", drawn <= icon.size * fontScale)
        } else {
            assertEquals("$case: the icon should keep its size", icon.size.value, drawn.value, 0.5f)
        }
        assertEquals("$case: the icon should be square", painter.drawnSize.width, painter.drawnSize.height, 0.5f)
    }

    /** The icon a component draws: its size at the default font size, and whether text sits next to it. */
    class IconCase(val size: Dp, val nextToText: Boolean)

    /**
     * One component as the tests see it. [content] draws it with a label,
     * turned on or off, calling the click handler it is given, with the
     * icon it is given if it has one.
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
        /** For chips and radio buttons, which can be selected: whether this one is. */
        val selected: Boolean? = null,
        /** For checkboxes and switches, which turn on and off: whether this one is on. */
        val toggleableState: ToggleableState? = null,
        /** The icon it draws from the painter it is given, if any. */
        val icon: IconCase? = null,
        val content: @Composable (label: String, enabled: Boolean, onClick: () -> Unit, icon: Painter) -> Unit,
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

        /** Material 3's icon sizes: in buttons and chips, and everywhere else. */
        private val SMALL_ICON = 18.dp
        private val ICON = 24.dp

        /** The icon above the title of an empty or an error state. */
        private val STATE_ICON = 48.dp

        /** The title of the empty and error states whose button is checked. */
        private const val STATE_TITLE = "No notes yet"

        private val CASES = listOf(
            ComponentCase("FilledButton", Role.Button, ButtonShape) { label, enabled, onClick, _ ->
                ShkFilledButton(text = label, onClick = onClick, enabled = enabled)
            },
            ComponentCase(
                "FilledButtonWithIcon",
                Role.Button,
                ButtonShape,
                icon = IconCase(SMALL_ICON, nextToText = true),
            ) { label, enabled, onClick, icon ->
                ShkFilledButton(text = label, onClick = onClick, enabled = enabled, icon = icon)
            },
            ComponentCase("TonalButton", Role.Button, ButtonShape) { label, enabled, onClick, _ ->
                ShkTonalButton(text = label, onClick = onClick, enabled = enabled)
            },
            ComponentCase(
                "TonalButtonWithIcon",
                Role.Button,
                ButtonShape,
                icon = IconCase(SMALL_ICON, nextToText = true),
            ) { label, enabled, onClick, icon ->
                ShkTonalButton(text = label, onClick = onClick, enabled = enabled, icon = icon)
            },
            ComponentCase("TextButton", Role.Button, ButtonShape) { label, enabled, onClick, _ ->
                ShkTextButton(text = label, onClick = onClick, enabled = enabled)
            },
            ComponentCase(
                "TextButtonWithIcon",
                Role.Button,
                ButtonShape,
                icon = IconCase(SMALL_ICON, nextToText = true),
            ) { label, enabled, onClick, icon ->
                ShkTextButton(text = label, onClick = onClick, enabled = enabled, icon = icon)
            },
            ComponentCase(
                "IconButton",
                Role.Button,
                ShkShapes.Pill,
                showsText = false,
                icon = IconCase(ICON, nextToText = false),
            ) { label, enabled, onClick, icon ->
                ShkIconButton(icon = icon, contentDescription = label, onClick = onClick, enabled = enabled)
            },
            ComponentCase(
                "FloatingActionButton",
                Role.Button,
                ShkShapes.Card,
                showsText = false,
                canBeDisabled = false,
                icon = IconCase(ICON, nextToText = false),
            ) { label, _, onClick, icon ->
                ShkFloatingActionButton(icon = icon, contentDescription = label, onClick = onClick)
            },
            ComponentCase(
                "ExtendedFloatingActionButton",
                Role.Button,
                ShkShapes.Card,
                canBeDisabled = false,
                icon = IconCase(ICON, nextToText = true),
            ) { label, _, onClick, icon ->
                ShkExtendedFloatingActionButton(text = label, icon = icon, onClick = onClick)
            },
            // Collapsed, no text shows, but the icon keeps its grown size,
            // so it does not jump when the button collapses.
            ComponentCase(
                "CollapsedExtendedFloatingActionButton",
                Role.Button,
                ShkShapes.Card,
                showsText = false,
                canBeDisabled = false,
                icon = IconCase(ICON, nextToText = true),
            ) { label, _, onClick, icon ->
                ShkExtendedFloatingActionButton(text = label, icon = icon, onClick = onClick, expanded = false)
            },
            ComponentCase("FilterChip", Role.Checkbox, ChipShape, selected = false) { label, enabled, onClick, _ ->
                ShkFilterChip(text = label, selected = false, onClick = onClick, enabled = enabled)
            },
            // Its check mark is drawn the same way as the assist chip's icon.
            ComponentCase("SelectedFilterChip", Role.Checkbox, ChipShape, selected = true) { label, enabled, onClick, _ ->
                ShkFilterChip(text = label, selected = true, onClick = onClick, enabled = enabled)
            },
            ComponentCase("AssistChip", Role.Button, ChipShape) { label, enabled, onClick, _ ->
                ShkAssistChip(text = label, onClick = onClick, enabled = enabled)
            },
            ComponentCase(
                "AssistChipWithIcon",
                Role.Button,
                ChipShape,
                icon = IconCase(SMALL_ICON, nextToText = true),
            ) { label, enabled, onClick, icon ->
                ShkAssistChip(text = label, onClick = onClick, enabled = enabled, icon = icon)
            },
            // The whole row of a selection control is its touch target, and
            // its pressed state is drawn in the field shape.
            ComponentCase(
                "Checkbox",
                Role.Checkbox,
                ShkShapes.Field,
                toggleableState = ToggleableState.Off,
            ) { label, enabled, onClick, _ ->
                ShkCheckbox(text = label, checked = false, onCheckedChange = { onClick() }, enabled = enabled)
            },
            ComponentCase(
                "CheckedCheckbox",
                Role.Checkbox,
                ShkShapes.Field,
                toggleableState = ToggleableState.On,
            ) { label, enabled, onClick, _ ->
                ShkCheckbox(text = label, checked = true, onCheckedChange = { onClick() }, enabled = enabled)
            },
            ComponentCase(
                "Switch",
                Role.Switch,
                ShkShapes.Field,
                toggleableState = ToggleableState.Off,
            ) { label, enabled, onClick, _ ->
                ShkSwitch(text = label, checked = false, onCheckedChange = { onClick() }, enabled = enabled)
            },
            ComponentCase(
                "CheckedSwitch",
                Role.Switch,
                ShkShapes.Field,
                toggleableState = ToggleableState.On,
            ) { label, enabled, onClick, _ ->
                ShkSwitch(text = label, checked = true, onCheckedChange = { onClick() }, enabled = enabled)
            },
            ComponentCase("RadioButton", Role.RadioButton, ShkShapes.Field, selected = false) { label, enabled, onClick, _ ->
                ShkRadioButton(text = label, selected = false, onClick = onClick, enabled = enabled)
            },
            ComponentCase(
                "SelectedRadioButton",
                Role.RadioButton,
                ShkShapes.Field,
                selected = true,
            ) { label, enabled, onClick, _ ->
                ShkRadioButton(text = label, selected = true, onClick = onClick, enabled = enabled)
            },
            // A card that can be tapped is one button, read by all its text.
            // It has no disabled state.
            ComponentCase("TappableCard", Role.Button, ShkShapes.Card, canBeDisabled = false) { label, _, onClick, _ ->
                ShkCard(onClick = onClick) { ShkText(text = label) }
            },
            // The whole row of a list item is its touch target, and its
            // pressed state is drawn in the field shape, as a selection
            // control's row is.
            ComponentCase("TappableListItem", Role.Button, ShkShapes.Field) { label, enabled, onClick, _ ->
                ShkListItem(headline = label, onClick = onClick, enabled = enabled)
            },
            ComponentCase(
                "TappableListItemWithIcon",
                Role.Button,
                ShkShapes.Field,
                icon = IconCase(ICON, nextToText = true),
            ) { label, enabled, onClick, icon ->
                ShkListItem(headline = label, onClick = onClick, enabled = enabled, icon = icon)
            },
            // The states' buttons are tonal buttons, and the icon of the
            // empty state sits above its title, next to text.
            ComponentCase(
                "EmptyStateButton",
                Role.Button,
                ButtonShape,
                canBeDisabled = false,
                icon = IconCase(STATE_ICON, nextToText = true),
            ) { label, _, onClick, icon ->
                ShkEmptyState(
                    title = STATE_TITLE,
                    icon = icon,
                    action = ShkStateAction(text = label, onClick = onClick),
                )
            },
            ComponentCase("ErrorStateButton", Role.Button, ButtonShape, canBeDisabled = false) { label, _, onClick, _ ->
                ShkErrorState(title = STATE_TITLE, action = ShkStateAction(text = label, onClick = onClick))
            },
        )
    }
}

/**
 * An icon that draws nothing and remembers the size it was last drawn at,
 * which is the size the component gave it. It has no size of its own.
 */
private class SizeRecordingPainter : Painter() {
    var drawnSize: Size = Size.Zero
        private set

    override val intrinsicSize: Size = Size.Unspecified

    override fun DrawScope.onDraw() {
        drawnSize = size
    }
}

private fun Rect.corners(): List<Offset> = listOf(topLeft, topRight, bottomLeft, bottomRight)

private fun Outline.contains(point: Offset): Boolean = when (this) {
    is Outline.Rectangle -> rect.contains(point)
    is Outline.Rounded -> roundRect.contains(point)
    is Outline.Generic -> error("Components are drawn in rounded rectangles, not paths")
}
