package app.shkriuss.core.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp

/**
 * Shows snackbars on a [ShkScreen]: short messages about something that
 * just happened, such as "Note deleted", with at most one action, such as
 * "Undo". Make one with [rememberShkSnackbarHostState] and pass it to the
 * screen's `snackbarHostState`. For a question that needs an answer, use
 * a [ShkDialog]. For something that went wrong with what a screen shows,
 * use a [ShkErrorState].
 *
 * A snackbar sits at the bottom of the screen, above its floating action
 * button, and goes away by itself. Only one shows at a time; the next
 * waits.
 */
@Stable
class ShkSnackbarHostState {
    internal val material = SnackbarHostState()

    /**
     * Shows [message], and waits until it goes away. With [actionText], it
     * has a button with those words, such as "Undo".
     *
     * Without an action it shows for 4 seconds, with one for 10, so there
     * is time to reach the button. Android's accessibility setting "Time
     * to take action" makes both longer. TalkBack reads the message when
     * it appears, after what it is saying.
     *
     * Returns [ShkSnackbarResult.ActionPerformed] if the button was
     * tapped, else [ShkSnackbarResult.Dismissed]. Call it from a coroutine
     * of the screen, such as one from `rememberCoroutineScope`.
     */
    suspend fun show(message: String, actionText: String? = null): ShkSnackbarResult {
        val result = material.showSnackbar(
            message = message,
            actionLabel = actionText,
            duration = if (actionText == null) SnackbarDuration.Short else SnackbarDuration.Long,
        )
        return when (result) {
            SnackbarResult.ActionPerformed -> ShkSnackbarResult.ActionPerformed
            SnackbarResult.Dismissed -> ShkSnackbarResult.Dismissed
        }
    }
}

/** How a snackbar went away. */
enum class ShkSnackbarResult {
    /** Its time ran out, or TalkBack dismissed it. */
    Dismissed,

    /** Its action was tapped. */
    ActionPerformed,
}

/** A [ShkSnackbarHostState] that lives as long as the screen. */
@Composable
fun rememberShkSnackbarHostState(): ShkSnackbarHostState = remember { ShkSnackbarHostState() }

/**
 * Where [ShkScreen] shows the snackbars of [state]. Material 3's host
 * times them, and makes each a polite live region that TalkBack can
 * dismiss. It fills the width and centres the snackbar in it.
 */
@Composable
internal fun ShkSnackbarHost(state: ShkSnackbarHostState, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.BottomCenter) {
        SnackbarHost(hostState = state.material) { data ->
            SnackbarPanel(
                message = data.visuals.message,
                actionText = data.visuals.actionLabel,
                onAction = { data.performAction() },
            )
        }
    }
}

/**
 * Draws a snackbar in place, as [ShkSnackbarHostState.show] shows it, for
 * the Catalog's samples (see [ShkInPlace]). It does not go away, and is
 * not announced. A tap on the action only calls [onAction].
 */
@ShkInPlace
@Composable
fun ShkSnackbarInPlace(
    message: String,
    modifier: Modifier = Modifier,
    actionText: String? = null,
    onAction: () -> Unit = {},
) {
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        SnackbarPanel(message = message, actionText = actionText, onAction = onAction)
    }
}

/**
 * One snackbar: the message, and the action beside it when both fit on
 * one line, or under it at the end when they do not. It is drawn in
 * Material 3's inverse colours: the text colour as its fill, the
 * background colour as its text, and the other theme's accent for the
 * action. So it stands out from every surface without a shadow or an
 * outline. It is at most 600dp wide, as in Material 3.
 */
@Composable
private fun SnackbarPanel(message: String, actionText: String?, onAction: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    Box(
        modifier = Modifier
            .widthIn(max = SnackbarMaxWidth)
            .fillMaxWidth()
            .heightIn(min = ShkSpacing.MinTouchTarget)
            .clip(ShkShapes.Field)
            .background(scheme.inverseSurface)
            .padding(start = ShkSpacing.Large, end = if (actionText == null) ShkSpacing.Large else ShkSpacing.Small),
        contentAlignment = Alignment.CenterStart,
    ) {
        MessageAndAction(
            message = {
                Text(
                    text = message,
                    color = scheme.inverseOnSurface,
                    style = ShkTextStyle.Body.textStyle,
                    modifier = Modifier.padding(vertical = MessageVerticalPadding),
                )
            },
            action = actionText?.let { text ->
                { ColoredTextButton(text = text, onClick = onAction, color = scheme.inversePrimary) }
            },
        )
    }
}

/**
 * Lays out a snackbar's message and its optional action. The action sits
 * beside the message, centred on it, when the message fits on one line
 * beside it. Otherwise the message takes the whole width and wraps, and
 * the action goes under it, at the end.
 */
@Composable
private fun MessageAndAction(message: @Composable () -> Unit, action: (@Composable () -> Unit)?) {
    Layout(
        content = {
            message()
            action?.invoke()
        },
    ) { measurables, constraints ->
        val loose = constraints.copy(minWidth = 0, minHeight = 0)
        val messageMeasurable = measurables[0]
        val actionPlaceable = measurables.getOrNull(1)?.measure(loose)
        val width = constraints.maxWidth
        if (actionPlaceable == null) {
            val text = messageMeasurable.measure(loose)
            return@Layout layout(width, text.height) { text.placeRelative(0, 0) }
        }
        val besideWidth = width - actionPlaceable.width
        val oneLine = messageMeasurable.maxIntrinsicWidth(Constraints.Infinity) <= besideWidth
        if (oneLine) {
            val text = messageMeasurable.measure(loose.copy(maxWidth = besideWidth))
            val height = maxOf(text.height, actionPlaceable.height)
            layout(width, height) {
                text.placeRelative(0, (height - text.height) / 2)
                actionPlaceable.placeRelative(width - actionPlaceable.width, (height - actionPlaceable.height) / 2)
            }
        } else {
            // The panel leaves less room at the end, for the button. The
            // message keeps as much room at the end as at the start.
            val endRoom = (ShkSpacing.Large - ShkSpacing.Small).roundToPx()
            val text = messageMeasurable.measure(loose.copy(maxWidth = (width - endRoom).coerceAtLeast(0)))
            val bottomRoom = ShkSpacing.ExtraSmall.roundToPx()
            layout(width, text.height + actionPlaceable.height + bottomRoom) {
                text.placeRelative(0, 0)
                actionPlaceable.placeRelative(width - actionPlaceable.width, text.height)
            }
        }
    }
}

/** The widest a snackbar gets, as in Material 3. */
private val SnackbarMaxWidth = 600.dp

/** The space above and below the message, which makes one line 48dp tall. */
private val MessageVerticalPadding = 14.dp
