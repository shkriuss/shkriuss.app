package app.shkriuss.catalog

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.ShkTopBarAction

/**
 * The top bar with a title only, with Back, with actions, with Back and
 * an action, with an action turned off, and with a long title. Each is in
 * a frame that stands for the top of a screen. Nothing here does anything
 * when tapped.
 */
@Composable
fun TopBarsPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_top_bars_title))
        PageIntro(stringResource(R.string.top_bars_intro))

        ComponentHeading(stringResource(R.string.top_bar_title), stringResource(R.string.top_bar_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_title_only) {
                    WindowFrame { ShkTopBar(title = stringResource(R.string.sample_notes)) }
                },
                ComponentState(R.string.state_with_back) {
                    WindowFrame { ShkTopBar(title = stringResource(R.string.sample_card_title), onBack = {}) }
                },
                ComponentState(R.string.state_with_actions) {
                    WindowFrame {
                        ShkTopBar(title = stringResource(R.string.sample_notes), actions = listOf(searchAction(), newNoteAction()))
                    }
                },
                ComponentState(R.string.state_with_back_and_action) {
                    WindowFrame {
                        ShkTopBar(
                            title = stringResource(R.string.sample_card_title),
                            onBack = {},
                            actions = listOf(reminderAction(enabled = true)),
                        )
                    }
                },
                ComponentState(R.string.state_action_disabled) {
                    WindowFrame {
                        ShkTopBar(
                            title = stringResource(R.string.sample_card_title),
                            onBack = {},
                            actions = listOf(reminderAction(enabled = false)),
                        )
                    }
                },
                ComponentState(R.string.state_long_text) {
                    WindowFrame {
                        ShkTopBar(
                            title = stringResource(R.string.sample_long_card_title),
                            onBack = {},
                            actions = listOf(searchAction(), reminderAction(enabled = true)),
                        )
                    }
                },
            ),
        )
    }
}

/** A search action that does nothing. */
@Composable
private fun searchAction() = ShkTopBarAction(
    icon = painterResource(R.drawable.sample_icon_search),
    label = stringResource(R.string.sample_search),
    onClick = {},
)

/** A "New note" action that does nothing. */
@Composable
private fun newNoteAction() = ShkTopBarAction(
    icon = painterResource(R.drawable.sample_icon_add),
    label = stringResource(R.string.sample_new_note),
    onClick = {},
)

/** An "Add a reminder" action that does nothing, on or turned off. */
@Composable
private fun reminderAction(enabled: Boolean) = ShkTopBarAction(
    icon = painterResource(R.drawable.sample_icon_alarm),
    label = stringResource(R.string.sample_add_reminder),
    onClick = {},
    enabled = enabled,
)
