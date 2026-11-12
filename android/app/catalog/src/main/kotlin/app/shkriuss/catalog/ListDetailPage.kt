package app.shkriuss.catalog

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.shkriuss.core.design.ShkEmptyState
import app.shkriuss.core.design.ShkListDetailScaffold
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.ShkWindowWidth

/**
 * The list-and-detail scaffold in one pane, showing the list and a note,
 * and, in a window wide enough, in two panes with nothing open and with a
 * note open. Then one to try, which follows the window. Each sample is in
 * a frame that stands for a window. Only the one to try does something
 * when tapped.
 */
@Composable
fun ListDetailPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_list_detail_title))
        PageIntro(stringResource(R.string.list_detail_intro))

        ComponentHeading(stringResource(R.string.list_detail_title), stringResource(R.string.list_detail_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_one_pane_list) {
                    WindowFrame(height = sampleFrameHeight()) {
                        ShkListDetailScaffold(
                            detailOpen = false,
                            onCloseDetail = {},
                            list = { NotesList(open = null, onOpen = {}) },
                            detail = {},
                            windowWidth = ShkWindowWidth.Compact,
                        )
                    }
                },
                // In one pane the scaffold shows the open note in place of
                // the list, and takes the back gesture to close it. A
                // sample that is always open would take the page's back
                // gesture too, so this one draws the open note as the
                // scaffold does, without it.
                ComponentState(R.string.state_one_pane_detail) {
                    WindowFrame(height = sampleFrameHeight()) { NoteDetail(SampleNote.Shopping, onBack = {}) }
                },
            ),
            wideColumns = 2,
        )
        Spacer(Modifier.height(ShkSpacing.Large))
        // Two panes are only shown where they would be in an app: in a
        // window at least 840dp wide, which leaves the frames room for both.
        if (ShkWindowWidth.current == ShkWindowWidth.Expanded) {
            ComponentStates(
                listOf(
                    ComponentState(R.string.state_two_panes_nothing_open) { TwoPanesSample(open = null) },
                    ComponentState(R.string.state_two_panes_open) { TwoPanesSample(open = SampleNote.Shopping) },
                ),
                wideColumns = 1,
            )
        } else {
            ShkText(text = stringResource(R.string.list_detail_two_panes_note), color = ShkTheme.colors.textSecondary)
        }
        Spacer(Modifier.height(ShkSpacing.Large))
        ComponentStates(listOf(ComponentState(R.string.state_try_list_detail) { ListDetailToTry() }), wideColumns = 1)
    }
}

/** The scaffold in two panes, with [open] beside the list, or nothing open. Taps do nothing. */
@Composable
private fun TwoPanesSample(open: SampleNote?) {
    WindowFrame(height = sampleFrameHeight()) {
        ShkListDetailScaffold(
            detailOpen = open != null,
            onCloseDetail = {},
            list = { NotesList(open = open, onOpen = {}) },
            detail = { onBack -> if (open == null) ChooseANote() else NoteDetail(open, onBack) },
            windowWidth = ShkWindowWidth.Expanded,
        )
    }
}

/**
 * The scaffold as an app uses it, following the window. A tap on a note
 * opens it. Back in its top bar, or the back gesture, returns to the list
 * in one pane.
 */
@Composable
private fun ListDetailToTry() {
    var open by rememberSaveable { mutableStateOf<SampleNote?>(null) }
    WindowFrame(height = TryFrameHeight) {
        ShkListDetailScaffold(
            detailOpen = open != null,
            onCloseDetail = { open = null },
            list = { NotesList(open = open, onOpen = { open = it }) },
            detail = { onBack ->
                val note = open
                if (note == null) {
                    ChooseANote()
                } else {
                    // Each note opens at its top.
                    key(note) { NoteDetail(note, onBack) }
                }
            },
        )
    }
}

/**
 * The list pane: a top bar and one list item for each note. The [open]
 * note is marked as selected. In one pane the list is not shown while a
 * note is open, so the mark shows in two panes.
 */
@Composable
private fun NotesList(open: SampleNote?, onOpen: (SampleNote) -> Unit) {
    ShkScreen(topBar = { ShkTopBar(title = stringResource(R.string.sample_notes)) }, scrollable = true) {
        SampleNote.entries.forEach { note ->
            ShkListItem(
                headline = stringResource(note.title),
                supportingText = stringResource(note.text),
                onClick = { onOpen(note) },
                selected = note == open,
            )
        }
    }
}

/** The detail pane for [note]: a top bar with its title, and Back when [onBack] is given, then its text. */
@Composable
private fun NoteDetail(note: SampleNote, onBack: (() -> Unit)?) {
    ShkScreen(topBar = { ShkTopBar(title = stringResource(note.title), onBack = onBack) }, scrollable = true) {
        ShkText(text = stringResource(note.text))
    }
}

/** What the detail pane shows in two panes while no note is open. */
@Composable
private fun ChooseANote() {
    ShkScreen(scrollable = true) {
        ShkEmptyState(
            title = stringResource(R.string.sample_choose_note),
            body = stringResource(R.string.sample_choose_note_body),
            icon = painterResource(R.drawable.sample_icon_note),
        )
    }
}

/** The notes of the samples, each with its title and text. */
private enum class SampleNote(@param:StringRes val title: Int, @param:StringRes val text: Int) {
    Shopping(R.string.sample_card_title, R.string.sample_card_text),
    Dentist(R.string.sample_call_dentist, R.string.sample_long_list_supporting),
    Summer(R.string.sample_long_card_title, R.string.sample_long_card_text),
}

/**
 * The height of the frames of the samples: [FrameHeight], grown as body
 * text grows, so a sample shows all its notes at every font size and
 * nothing looks cut off at its edge.
 */
@Composable
private fun sampleFrameHeight(): Dp {
    val bodySize = ShkTextStyle.Body.fontSize
    val growth = with(LocalDensity.current) { bodySize.toDp() } / bodySize.value.dp
    return FrameHeight * maxOf(1f, growth)
}

/** The height of the frames of the samples at the default font size. */
private val FrameHeight = 360.dp

/** The height of the frame to try, taller so it feels like a screen. */
private val TryFrameHeight = 480.dp
