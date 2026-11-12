package app.shkriuss.core.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/**
 * A dialog: a question the user answers before going on, such as "Delete
 * this note?". Use it only when the answer matters and cannot wait, as
 * before something that cannot be undone. For news that needs no answer,
 * such as "Note deleted", use a snackbar ([ShkSnackbarHostState]). For
 * more than a few choices or fields, use a [ShkBottomSheet] or a screen
 * of its own.
 *
 * [title] is the question, or what the dialog is about. TalkBack reads it
 * when the dialog opens, and as a heading. [text] is an optional line
 * under it. [content] is optional and goes under the text: a choice, such
 * as a [ShkRadioGroup], or a [ShkTextField].
 *
 * [confirmAction] answers the question, such as "Delete", and sits at the
 * end. [dismissAction] is the way out, such as "Cancel", before it. Each
 * is a text button read by its text, with a 48dp touch target. A tap on
 * one calls it, then [onDismissRequest]. A tap outside the dialog and Back
 * call only [onDismissRequest]. Stop showing the dialog there.
 *
 * It is the higher surface colour with a 1dp outline and
 * [ShkShapes.Sheet] corners, and has no shadow (ADR 0017, point 5). It is
 * 280 to 560dp wide. The buttons sit side by side and move one above the
 * other, the confirm button on top, when they do not fit. All text
 * wraps. When the dialog is taller than the window, as at font scale 2.0
 * in a small window, everything above the buttons scrolls, so nothing is
 * cut off and the buttons stay in reach.
 */
@Composable
fun ShkDialog(
    title: String,
    confirmAction: ShkDialogAction,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    text: String? = null,
    dismissAction: ShkDialogAction? = null,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    Dialog(onDismissRequest = onDismissRequest, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        AlertPanel(
            title = title,
            text = text,
            confirmAction = confirmAction,
            dismissAction = dismissAction,
            onAction = onDismissRequest,
            inWindow = true,
            modifier = modifier.padding(DialogWindowMargin),
            content = content,
        )
    }
}

/**
 * Draws a [ShkDialog] in place, without its window, for the Catalog's
 * samples (see [ShkInPlace]). A tap on an action only calls it.
 */
@ShkInPlace
@Composable
fun ShkDialogInPlace(
    title: String,
    confirmAction: ShkDialogAction,
    modifier: Modifier = Modifier,
    text: String? = null,
    dismissAction: ShkDialogAction? = null,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    AlertPanel(
        title = title,
        text = text,
        confirmAction = confirmAction,
        dismissAction = dismissAction,
        onAction = {},
        inWindow = false,
        modifier = modifier,
        content = content,
    )
}

/**
 * A button of a [ShkDialog]: its words and what a tap does. They come as
 * one value, so a dialog never shows a button without its words (as with
 * [ShkStateAction]).
 */
class ShkDialogAction(
    /** The words on the button, such as "Delete" or "Cancel". Say what it does; avoid "Yes" and "No". */
    val text: String,
    /** What a tap does. The dialog then closes. */
    val onClick: () -> Unit,
    /** False while the action is not possible, such as before a choice is made. TalkBack reads "disabled". */
    val enabled: Boolean = true,
    /** True for an action that destroys something, such as "Delete". Its text is the error colour. */
    val destructive: Boolean = false,
)

/**
 * The panel of a [ShkDialog]: the title, the text and content, and the
 * buttons. [inWindow] is false for a dialog drawn in place on a page.
 */
@Composable
private fun AlertPanel(
    title: String,
    text: String?,
    confirmAction: ShkDialogAction,
    dismissAction: ShkDialogAction?,
    onAction: () -> Unit,
    inWindow: Boolean,
    modifier: Modifier,
    content: (@Composable ColumnScope.() -> Unit)?,
) {
    val colors = ShkTheme.colors
    DialogPanel(
        paneTitle = if (inWindow) title else null,
        scrollable = inWindow,
        modifier = modifier.sizeIn(minWidth = DialogMinWidth, maxWidth = DialogMaxWidth),
        bodyPadding = PaddingValues(start = DialogPadding, top = DialogPadding, end = DialogPadding),
        buttonsPadding = PaddingValues(DialogPadding),
        buttons = {
            DialogButtons {
                if (dismissAction != null) DialogActionButton(dismissAction, onAction)
                DialogActionButton(confirmAction, onAction)
            }
        },
    ) {
        ShkText(
            text = title,
            style = ShkTextStyle.Title,
            color = colors.text,
            modifier = Modifier.semantics { heading() },
        )
        if (text != null) {
            Spacer(Modifier.height(ShkSpacing.Large))
            ShkText(text = text, color = colors.textSecondary)
        }
        if (content != null) {
            Spacer(Modifier.height(ShkSpacing.Large))
            content()
        }
    }
}

/** One action of a dialog, as a text button: the accent, or the error colour when destructive. */
@Composable
private fun DialogActionButton(action: ShkDialogAction, onAction: () -> Unit) {
    val colors = ShkTheme.colors
    ColoredTextButton(
        text = action.text,
        onClick = {
            action.onClick()
            onAction()
        },
        color = if (action.destructive) colors.error else colors.accent,
        enabled = action.enabled,
    )
}

/**
 * The panel every dialog of the suite is drawn in: a dialog, a date
 * picker and a time picker. It is the higher surface colour with a 1dp
 * outline and [ShkShapes.Sheet] corners. [body] sits above [buttons].
 * With [scrollable], the body scrolls when the panel is taller than the
 * window, and the buttons stay in place. A dialog in place on a page
 * does not scroll: the page does.
 *
 * TalkBack reads [paneTitle] when the panel opens in its window. A panel
 * in place on a page has none, so TalkBack does not announce every sample
 * as a new pane.
 */
@Composable
internal fun DialogPanel(
    paneTitle: String?,
    scrollable: Boolean,
    modifier: Modifier,
    bodyPadding: PaddingValues,
    buttonsPadding: PaddingValues,
    buttons: @Composable () -> Unit,
    body: @Composable ColumnScope.() -> Unit,
) {
    val colors = ShkTheme.colors
    CompositionLocalProvider(LocalContentColor provides colors.text) {
        Column(
            modifier = modifier
                .then(if (paneTitle != null) Modifier.semantics { this.paneTitle = paneTitle } else Modifier)
                .clip(ShkShapes.Sheet)
                .background(colors.surfaceHigh)
                .border(PanelOutlineWidth, colors.outline, ShkShapes.Sheet),
        ) {
            val scroll = if (scrollable) {
                Modifier
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState())
            } else {
                Modifier
            }
            Column(modifier = scroll.padding(bodyPadding), content = body)
            Box(
                modifier = Modifier
                    .align(Alignment.End)
                    .padding(buttonsPadding),
            ) {
                buttons()
            }
        }
    }
}

/**
 * The buttons of a dialog, in the order given: side by side at the end
 * when they fit, else one above the other, at the end, the last one on
 * top. The last one is the confirm button, so it stays nearest the
 * content in both. Each keeps its own width; text that is wider than the
 * dialog wraps.
 */
@Composable
internal fun DialogButtons(content: @Composable () -> Unit) {
    Layout(content = content) { measurables, constraints ->
        val gap = ButtonGap.roundToPx()
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val placeables = measurables.map { it.measure(loose) }
        val rowWidth = placeables.sumOf { it.width } + gap * (placeables.size - 1).coerceAtLeast(0)
        if (rowWidth <= constraints.maxWidth) {
            val height = placeables.maxOfOrNull { it.height } ?: 0
            layout(rowWidth, height) {
                var x = 0
                placeables.forEach { placeable ->
                    placeable.placeRelative(x, (height - placeable.height) / 2)
                    x += placeable.width + gap
                }
            }
        } else {
            val width = placeables.maxOf { it.width }
            val height = placeables.sumOf { it.height } + gap * (placeables.size - 1)
            layout(width, height) {
                var y = 0
                placeables.asReversed().forEach { placeable ->
                    placeable.placeRelative(width - placeable.width, y)
                    y += placeable.height + gap
                }
            }
        }
    }
}

/**
 * The space around a dialog in its window, so it never touches the edges
 * of a phone. The suite sets it rather than the platform, so every dialog,
 * picker or not, keeps the same space.
 */
internal val DialogWindowMargin: Dp = ShkSpacing.Large

/** The padding inside a dialog, as in Material 3. */
internal val DialogPadding: Dp = ShkSpacing.ExtraLarge

/** The narrowest a dialog gets, as in Material 3. */
private val DialogMinWidth = 280.dp

/** The widest a dialog gets, as in Material 3. */
private val DialogMaxWidth = 560.dp

/** The space between two buttons of a dialog, both ways. Each button already has a 48dp touch target. */
private val ButtonGap = ShkSpacing.Small

/** The outline of every raised surface: 1dp (ADR 0017, point 5). */
internal val PanelOutlineWidth: Dp = 1.dp
