package app.shkriuss.catalog

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkExtendedFloatingActionButton
import app.shkriuss.core.design.ShkFloatingActionButton
import app.shkriuss.core.design.ShkScreen

/**
 * The floating action button, and the extended one expanded, collapsed
 * and with a label long enough to wrap. Neither has a disabled state.
 * In an app they float above the content; here they sit in the page.
 */
@Composable
fun FloatingActionButtonsPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_fab_title))
        PageIntro(stringResource(R.string.fab_intro))

        ComponentHeading(stringResource(R.string.fab_title), stringResource(R.string.fab_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_enabled) {
                    ShkFloatingActionButton(
                        icon = painterResource(R.drawable.sample_icon_add),
                        contentDescription = stringResource(R.string.sample_new_note),
                        onClick = {},
                    )
                },
            ),
        )

        ComponentHeading(stringResource(R.string.fab_extended_title), stringResource(R.string.fab_extended_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_expanded) { NewNoteButton(R.string.sample_new_note, expanded = true) },
                ComponentState(R.string.state_collapsed) { NewNoteButton(R.string.sample_new_note, expanded = false) },
                ComponentState(R.string.state_long_label) { NewNoteButton(R.string.sample_long_fab, expanded = true) },
            ),
        )
    }
}

/** The sample extended floating action button, with the plus icon. */
@Composable
private fun NewNoteButton(@StringRes text: Int, expanded: Boolean) {
    ShkExtendedFloatingActionButton(
        text = stringResource(text),
        icon = painterResource(R.drawable.sample_icon_add),
        onClick = {},
        expanded = expanded,
    )
}
