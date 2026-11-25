package app.shkriuss.core.design

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * A place to write long text, such as the text of a note, with no box
 * around it: the text sits on the screen as text does. For a short value
 * with a label, such as a name, use a [ShkTextField] instead.
 *
 * [hint] shows in the secondary text colour while the text is empty, and
 * TalkBack reads it with the field then. TalkBack reads the text as it is.
 * [style] is the style of the text, [ShkTextStyle.Body] by default, or
 * [ShkTextStyle.Title] for a title. With [singleLine] it is one line tall
 * and scrolls sideways; otherwise it grows with the text, so put it in a
 * screen that scrolls. It is at least 48dp tall and fills the width it is
 * given.
 *
 * [text] and its selection, from [selectionStart] to [selectionEnd], come
 * from the caller, and every change goes to [onChange] with the new text
 * and selection. The caller may keep the text it had, or change it, as
 * when Enter continues a list: the editor shows what it is given.
 *
 * [looks] style ranges of the text, such as the marks of formatting in
 * the secondary colour ([ShkTextLook]). Showing never changes the text,
 * and a range that does not fit the text is left out. A tap on one of
 * [tapRanges], such as the box `[ ]` of a checklist item, calls [onTapRange]
 * with that range and does not move the cursor or open the keyboard. Each
 * range is a touch target at least 48 by 48 dp around its characters;
 * where two overlap, a tap goes to the nearer range. A tap anywhere else
 * places the cursor, as in every field.
 *
 * [action] is an optional action that TalkBack offers on the field, such
 * as "Tick" while the cursor is on a checklist item.
 *
 * [errorText] shows under the text in the error colour, such as "A note
 * has at most 100,000 characters.", and TalkBack announces it as the
 * field's error, once.
 *
 * With [keyboardLearns] false, the editor asks the keyboard not to learn
 * what is typed, as [ShkTextField] does. Pass a focus requester or a
 * focus listener in [modifier]: they act on the editor itself.
 */
@Composable
fun ShkTextEditor(
    text: String,
    selectionStart: Int,
    selectionEnd: Int,
    onChange: (text: String, selectionStart: Int, selectionEnd: Int) -> Unit,
    hint: String,
    modifier: Modifier = Modifier,
    style: ShkTextStyle = ShkTextStyle.Body,
    singleLine: Boolean = false,
    looks: List<ShkTextRange> = emptyList(),
    tapRanges: List<IntRange> = emptyList(),
    onTapRange: (IntRange) -> Unit = {},
    action: ShkEditorAction? = null,
    errorText: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    keyboardLearns: Boolean = true,
) {
    val given = TextRange(selectionStart.coerceIn(0, text.length), selectionEnd.coerceIn(0, text.length))
    // The value the field had last keeps the keyboard's composing region while it shows the same text and
    // selection, so a word being typed is not cut off at each key.
    var last by remember { mutableStateOf(TextFieldValue(text, given)) }
    val shown = if (last.text == text && last.selection == given) last else TextFieldValue(text, given)
    // Once the caller changed the text, the composing region of before is gone: it never comes back with an older text.
    SideEffect { if (last !== shown) last = shown }
    val field = @Composable {
        EditorField(
            value = shown,
            onValueChange = { changed ->
                last = changed
                if (changed.text != text || changed.selection != given) {
                    onChange(changed.text, changed.selection.start, changed.selection.end)
                }
            },
            hint = hint,
            modifier = modifier,
            style = style,
            singleLine = singleLine,
            looks = looks,
            tapRanges = tapRanges,
            onTapRange = onTapRange,
            action = action,
            errorText = errorText,
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
        )
    }
    if (keyboardLearns) field() else NoLearningKeyboard(field)
}

/**
 * A [ShkTextEditor] that keeps its own selection, for text whose cursor
 * the caller does not need, such as a title. Every change goes to
 * [onTextChange]. The caller may keep the text it had: the editor then
 * shows that.
 */
@Composable
fun ShkTextEditor(
    text: String,
    onTextChange: (String) -> Unit,
    hint: String,
    modifier: Modifier = Modifier,
    style: ShkTextStyle = ShkTextStyle.Body,
    singleLine: Boolean = false,
    errorText: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    keyboardLearns: Boolean = true,
) {
    var selection by remember { mutableStateOf(TextRange(text.length)) }
    ShkTextEditor(
        text = text,
        selectionStart = selection.start,
        selectionEnd = selection.end,
        onChange = { changed, start, end ->
            selection = TextRange(start, end)
            if (changed != text) onTextChange(changed)
        },
        hint = hint,
        modifier = modifier,
        style = style,
        singleLine = singleLine,
        errorText = errorText,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
        keyboardLearns = keyboardLearns,
    )
}

/** How a range of the text of a [ShkTextEditor] looks. Showing never changes the text. */
enum class ShkTextLook {
    /** In the secondary text colour, such as the marks of formatting. */
    Quiet,

    /** In the size and weight of [ShkTextStyle.Subtitle], the heading of a group, such as a heading line of a note. */
    Heading,

    /** Bold. */
    Bold,

    /** Italic. */
    Italic,

    /** Struck through, such as the text of a done checklist item. Give it [Quiet] too to dim it. */
    StruckThrough,
}

/** One range of the text of a [ShkTextEditor], from [start] to [end], not included, with its [look]. */
data class ShkTextRange(val look: ShkTextLook, val start: Int, val end: Int)

/**
 * An action that TalkBack offers on a [ShkTextEditor]: its [label], such
 * as "Tick", and what it does. They come as one value, so an action never
 * comes without its words.
 */
class ShkEditorAction(
    /** What TalkBack names the action. */
    val label: String,
    /** What the action does. */
    val onClick: () -> Unit,
)

/** The field of a [ShkTextEditor], given its value. */
@Composable
private fun EditorField(
    value: TextFieldValue,
    onValueChange: (TextFieldValue) -> Unit,
    hint: String,
    modifier: Modifier,
    style: ShkTextStyle,
    singleLine: Boolean,
    looks: List<ShkTextRange>,
    tapRanges: List<IntRange>,
    onTapRange: (IntRange) -> Unit,
    action: ShkEditorAction?,
    errorText: String?,
    keyboardOptions: KeyboardOptions,
    keyboardActions: KeyboardActions,
) {
    val colors = ShkTheme.colors
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    val ranges by rememberUpdatedState(tapRanges)
    val onTap by rememberUpdatedState(onTapRange)
    val selectionColors = TextSelectionColors(handleColor = colors.accent, backgroundColor = colors.accent.copy(alpha = SelectionAlpha))
    val styled = remember(value.text, looks, colors) { StyledText(value.text, looks, colors) }
    CompositionLocalProvider(LocalTextSelectionColors provides selectionColors) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = modifier
                .fillMaxWidth()
                .heightIn(min = ShkSpacing.MinTouchTarget)
                // The hint and the error line are read with the field, as the label of a ShkTextField is.
                .semantics(mergeDescendants = true) {
                    if (errorText != null) error(errorText)
                    if (action != null) {
                        customActions = listOf(
                            CustomAccessibilityAction(action.label) {
                                action.onClick()
                                true
                            },
                        )
                    }
                }
                .tapsOnRanges({ layout }, { ranges }, { onTap(it) }),
            textStyle = style.textStyle.copy(color = colors.text),
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            singleLine = singleLine,
            visualTransformation = styled,
            onTextLayout = { layout = it },
            cursorBrush = SolidColor(colors.accent),
            decorationBox = { innerTextField ->
                Column {
                    Box(Modifier.fillMaxWidth().heightIn(min = ShkSpacing.MinTouchTarget), propagateMinConstraints = false) {
                        if (value.text.isEmpty()) {
                            ShkText(text = hint, style = style, color = colors.textSecondary)
                        }
                        innerTextField()
                    }
                    if (errorText != null) {
                        ShkText(
                            text = errorText,
                            style = ShkTextStyle.Caption,
                            color = colors.error,
                            // Announced as the field's error, so not read again as text.
                            modifier = Modifier
                                .padding(top = ShkSpacing.ExtraSmall)
                                .clearAndSetSemantics {},
                        )
                    }
                }
            },
        )
    }
}

/**
 * Takes a tap on one of the ranges that [ranges] gives, before the field
 * sees it: the field neither moves its cursor nor takes the focus, and
 * [onTap] gets the range. Every other touch goes on to the field. A range
 * is hit inside the boxes of its characters, a little wider, and as tall
 * as its line, grown to at least [least] each way around its middle, as
 * every touch target is. A press that moves past the touch slop is no
 * tap: it goes on, so that a screen that scrolls can scroll from it.
 */
private fun Modifier.tapsOnRanges(
    layout: () -> TextLayoutResult?,
    ranges: () -> List<IntRange>,
    onTap: (IntRange) -> Unit,
): Modifier = pointerInput(Unit) {
    val slop = TapSlop.toPx()
    val least = ShkSpacing.MinTouchTarget.toPx()
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        val hit = layout()?.let { result -> rangeAt(result, ranges(), down.position, slop, least) } ?: return@awaitEachGesture
        down.consume()
        while (true) {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val change = event.changes.firstOrNull { it.id == down.id } ?: return@awaitEachGesture
            if ((change.position - down.position).getDistance() > viewConfiguration.touchSlop) return@awaitEachGesture
            if (!change.pressed) {
                change.consume()
                if (rangeAt(layout() ?: return@awaitEachGesture, listOf(hit), change.position, slop, least) != null) onTap(hit)
                return@awaitEachGesture
            }
        }
    }
}

/**
 * The range of [ranges] whose touch target, in [layout], holds [position],
 * or null: its characters, [slop] wider on each side, as tall as its line,
 * and at least [least] each way. Where several hold it, the one whose
 * middle is nearest, so that a tap between two checklist items goes to
 * the box it is closer to.
 */
private fun rangeAt(layout: TextLayoutResult, ranges: List<IntRange>, position: Offset, slop: Float, least: Float): IntRange? {
    val length = layout.layoutInput.text.length
    return ranges.mapNotNull { range ->
        if (range.isEmpty() || range.first < 0 || range.last >= length) return@mapNotNull null
        val first = layout.getBoundingBox(range.first)
        val last = layout.getBoundingBox(range.last)
        val line = layout.getLineForOffset(range.first)
        val area = Rect(
            left = minOf(first.left, last.left) - slop,
            top = layout.getLineTop(line),
            right = maxOf(first.right, last.right) + slop,
            bottom = layout.getLineBottom(line),
        ).atLeast(least)
        if (area.contains(position)) range to (area.center - position).getDistanceSquared() else null
    }.minByOrNull { it.second }?.first
}

/** This rectangle, grown evenly around its middle to at least [side] wide and tall. */
private fun Rect.atLeast(side: Float): Rect {
    val wider = maxOf(0f, side - width) / 2
    val taller = maxOf(0f, side - height) / 2
    return Rect(left - wider, top - taller, right + wider, bottom + taller)
}

/**
 * Shows the text with the styles of [looks], and the same characters at
 * the same places: the cursor and the selection need no mapping. Ranges
 * are for [text]; while the field shows other text, they are left out.
 */
private class StyledText(
    private val text: String,
    private val looks: List<ShkTextRange>,
    private val colors: ShkColors,
) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        if (looks.isEmpty() || text.text != this.text) return TransformedText(text, OffsetMapping.Identity)
        val styled = AnnotatedString.Builder(text)
        looks.forEach { range ->
            if (range.start < 0 || range.end > text.length || range.start >= range.end) return@forEach
            styled.addStyle(spanOf(range.look), range.start, range.end)
        }
        return TransformedText(styled.toAnnotatedString(), OffsetMapping.Identity)
    }

    private fun spanOf(look: ShkTextLook): SpanStyle = when (look) {
        ShkTextLook.Quiet -> SpanStyle(color = colors.textSecondary)
        ShkTextLook.Heading -> SpanStyle(fontSize = ShkTextStyle.Subtitle.fontSize, fontWeight = ShkTextStyle.Subtitle.fontWeight)
        ShkTextLook.Bold -> SpanStyle(fontWeight = FontWeight.Bold)
        ShkTextLook.Italic -> SpanStyle(fontStyle = FontStyle.Italic)
        ShkTextLook.StruckThrough -> SpanStyle(textDecoration = TextDecoration.LineThrough)
    }

    // Two of them are the same when they show the same text the same way, so the field does not lay out again.
    override fun equals(other: Any?): Boolean =
        other is StyledText && other.text == text && other.looks == looks && other.colors == colors

    override fun hashCode(): Int = 31 * text.hashCode() + looks.hashCode()
}

/** How far past its characters a tap still hits a range, on each side. */
private val TapSlop: Dp = 4.dp

/** The fill of selected text, as in Material 3: the accent, faint. */
private const val SelectionAlpha = 0.4f
