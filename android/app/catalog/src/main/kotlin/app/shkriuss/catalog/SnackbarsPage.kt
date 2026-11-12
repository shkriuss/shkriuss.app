package app.shkriuss.catalog

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.shkriuss.core.design.ShkFloatingActionButton
import app.shkriuss.core.design.ShkInPlace
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkSnackbarInPlace
import app.shkriuss.core.design.ShkSnackbarResult
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.rememberShkSnackbarHostState
import kotlinx.coroutines.launch

/**
 * The snackbar with a message only, with an action and with long text,
 * each drawn in place. Then one to try: a screen in a frame, whose
 * floating action button shows a snackbar above itself. Only that button
 * and the snackbar's action do something when tapped.
 */
@OptIn(ShkInPlace::class)
@Composable
fun SnackbarsPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_snackbars_title))
        PageIntro(stringResource(R.string.snackbars_intro))

        ComponentHeading(stringResource(R.string.snackbar_title), stringResource(R.string.snackbar_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_message_only) {
                    ShkSnackbarInPlace(message = stringResource(R.string.sample_note_saved))
                },
                ComponentState(R.string.state_with_action) {
                    ShkSnackbarInPlace(
                        message = stringResource(R.string.sample_note_deleted),
                        actionText = stringResource(R.string.sample_undo),
                    )
                },
                ComponentState(R.string.state_long_text) {
                    ShkSnackbarInPlace(
                        message = stringResource(R.string.sample_long_snackbar),
                        actionText = stringResource(R.string.sample_undo),
                    )
                },
            ),
            // Each panel keeps its own height, as in its window.
            equalHeights = false,
        )
        Spacer(Modifier.height(ShkSpacing.Large))
        ComponentStates(
            listOf(ComponentState(R.string.state_try_snackbar) { SnackbarToTry() }),
            wideColumns = 1,
        )
    }
}

/**
 * A screen in a frame, with a count of notes and a floating action button
 * that adds one. Each new note shows "Note added" with "Undo", which takes
 * it away again.
 */
@Composable
private fun SnackbarToTry() {
    var notes by rememberSaveable { mutableIntStateOf(0) }
    val snackbars = rememberShkSnackbarHostState()
    val scope = rememberCoroutineScope()
    val added = stringResource(R.string.sample_note_added)
    val undo = stringResource(R.string.sample_undo)
    WindowFrame(height = tryFrameHeight()) {
        ShkScreen(
            topBar = { ShkTopBar(title = stringResource(R.string.sample_notes)) },
            floatingActionButton = {
                ShkFloatingActionButton(
                    icon = painterResource(R.drawable.sample_icon_add),
                    contentDescription = stringResource(R.string.sample_new_note),
                    onClick = {
                        notes++
                        scope.launch {
                            if (snackbars.show(message = added, actionText = undo) == ShkSnackbarResult.ActionPerformed) {
                                notes--
                            }
                        }
                    },
                )
            },
            snackbarHostState = snackbars,
        ) {
            ShkText(text = pluralStringResource(R.plurals.sample_note_count, notes, notes), style = ShkTextStyle.Subtitle)
        }
    }
}

/**
 * The height of the frame to try. It grows as body text grows, so at
 * font scale 2.0 the snackbar and the button still fit under the count.
 */
@Composable
private fun tryFrameHeight(): Dp {
    val bodySize = ShkTextStyle.Body.fontSize
    val growth = with(LocalDensity.current) { bodySize.toDp() } / bodySize.value.dp
    return TryFrameHeight * maxOf(1f, growth)
}

/** The height of the frame to try at the default font size. */
private val TryFrameHeight = 320.dp
