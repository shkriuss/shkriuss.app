package app.shkriuss.core.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.layout
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.dismiss
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.constrainHeight
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.offset
import kotlinx.coroutines.launch

/**
 * A bottom sheet: a panel that slides up over the screen with a few
 * actions or a short form about what is on it, such as Share, Duplicate
 * and Delete for a note. Use it when the choices need more room than a
 * [ShkMenu] gives them, such as a second line of text, or for a short
 * form. For a question that needs an answer, use a [ShkDialog].
 *
 * [title] is optional. TalkBack reads it as a heading. [content] goes
 * under it, one item under the other. Put [ShkListItem]s with `onClick`
 * in it for actions: their text lines up with the title, at the screen
 * margin, and only their pressed state reaches past it. To close the
 * sheet after an action, stop showing it.
 *
 * A swipe down, a tap on the dimmed screen above it and Back close it
 * too, and call [onDismissRequest]. Stop showing it there. TalkBack reads
 * the handle at its top as "Drag handle", and offers "Dismiss" on it.
 *
 * It opens to the height of its content, up to the whole window, and its
 * content scrolls beyond that, so at font scale 2.0 nothing is cut off.
 * It keeps its content clear of the navigation bar. It is the higher
 * surface colour with a 1dp outline and [ShkShapes.Sheet] corners at the
 * top, with no shadow (ADR 0017, point 5). The bottom sits on the edge of
 * the window, so it has no line. In a wide window it is at most 640dp
 * wide, in the middle, as in Material 3.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShkBottomSheet(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = ShkTheme.colors
    // The sheet opens to the height of its content. A half-open step
    // would hide part of a short list of actions.
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    ModalBottomSheet(
        onDismissRequest = onDismissRequest,
        modifier = modifier,
        sheetState = state,
        shape = SheetShape,
        containerColor = colors.surfaceHigh,
        contentColor = colors.text,
        tonalElevation = 0.dp,
        // The handle, the outline and the space for the system bars are
        // drawn inside the content, so the outline covers the whole
        // sheet. Material 3 draws its modifier where the sheet would be
        // before it slides up.
        dragHandle = null,
        contentWindowInsets = { WindowInsets(0) },
    ) {
        SheetPanel(
            title = title,
            inWindow = true,
            onHandleDismiss = {
                scope.launch { state.hide() }.invokeOnCompletion { onDismissRequest() }
            },
            content = content,
        )
    }
}

/**
 * Draws a [ShkBottomSheet] in place, without its window and the dimmed
 * screen, for the Catalog's samples (see [ShkInPlace]). It fills the
 * width it is given.
 */
@ShkInPlace
@Composable
fun ShkBottomSheetInPlace(
    modifier: Modifier = Modifier,
    title: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = ShkTheme.colors
    CompositionLocalProvider(LocalContentColor provides colors.text) {
        Box(
            modifier = modifier
                .fillMaxWidth()
                .clip(SheetShape)
                .background(colors.surfaceHigh),
        ) {
            SheetPanel(title = title, inWindow = false, onHandleDismiss = null, content = content)
        }
    }
}

/**
 * Everything on a sheet: its outline, the handle, the title and the
 * content. In its window, the content scrolls and keeps clear of the
 * system bars, and the handle offers TalkBack "Dismiss", which calls
 * [onHandleDismiss].
 */
@Composable
private fun SheetPanel(
    title: String?,
    inWindow: Boolean,
    onHandleDismiss: (() -> Unit)?,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .sheetOutline(ShkTheme.colors.outline),
    ) {
        SheetHandle(onDismiss = onHandleDismiss)
        val scroll = if (inWindow) {
            Modifier
                .verticalScroll(rememberScrollState())
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
        } else {
            Modifier
        }
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .then(scroll)
                .screenMargins(),
        ) {
            if (title != null) {
                ShkText(
                    text = title,
                    style = ShkTextStyle.Title,
                    modifier = Modifier
                        .padding(bottom = ShkSpacing.Small)
                        .semantics { heading() },
                )
            }
            content()
        }
    }
}

/**
 * Pads the sides and the bottom by the screen margin for the width given,
 * as [ShkScreen] does. It reads the width from the constraints rather
 * than with `BoxWithConstraints`, so a sheet drawn in place still answers
 * intrinsic measurements, as in a row of equal heights.
 */
private fun Modifier.screenMargins(): Modifier = layout { measurable, constraints ->
    val margin = if (constraints.hasBoundedWidth) {
        ShkSpacing.screenMargin(constraints.maxWidth.toDp())
    } else {
        ShkSpacing.ScreenMargin
    }.roundToPx()
    val placeable = measurable.measure(constraints.offset(horizontal = -2 * margin, vertical = -margin))
    val width = constraints.constrainWidth(placeable.width + 2 * margin)
    val height = constraints.constrainHeight(placeable.height + margin)
    layout(width, height) { placeable.placeRelative(margin, 0) }
}

/**
 * The 1dp outline of a sheet, along its rounded top and down its sides.
 * The bottom sits on the edge of the window and has no line.
 */
private fun Modifier.sheetOutline(color: Color): Modifier = drawBehind {
    val stroke = PanelOutlineWidth.toPx()
    val half = stroke / 2
    val corner = ShkShapes.SheetCorner.toPx()
    val path = Path().apply {
        moveTo(half, size.height)
        lineTo(half, corner)
        arcTo(Rect(half, half, 2 * corner - half, 2 * corner - half), 180f, 90f, false)
        lineTo(size.width - corner, half)
        arcTo(Rect(size.width - 2 * corner + half, half, size.width - half, 2 * corner - half), 270f, 90f, false)
        lineTo(size.width - half, size.height)
    }
    drawPath(path, color, style = Stroke(width = stroke))
}

/**
 * The handle at the top of a sheet: a short bar in the outline colour, in
 * a strip 48dp tall. In a window, TalkBack reads it as "Drag handle" and
 * offers "Dismiss", which closes the sheet as a swipe down does. In place
 * it is only drawn.
 */
@Composable
private fun SheetHandle(onDismiss: (() -> Unit)?) {
    val label = stringResource(R.string.shk_drag_handle)
    val semantics = if (onDismiss != null) {
        Modifier.semantics {
            contentDescription = label
            dismiss {
                onDismiss()
                true
            }
        }
    } else {
        Modifier.clearAndSetSemantics {}
    }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(ShkSpacing.MinTouchTarget)
            .then(semantics),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(width = HandleWidth, height = HandleHeight)
                .clip(ShkShapes.Pill)
                .background(ShkTheme.colors.outline),
        )
    }
}

/** [ShkShapes.Sheet] corners at the top only. The bottom sits on the edge of the window. */
private val SheetShape = RoundedCornerShape(
    topStart = ShkShapes.SheetCorner,
    topEnd = ShkShapes.SheetCorner,
    bottomStart = 0.dp,
    bottomEnd = 0.dp,
)

/** The size of the handle's bar, as in Material 3. */
private val HandleWidth = 32.dp
private val HandleHeight = 4.dp
