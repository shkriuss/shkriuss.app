package app.shkriuss.catalog

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkEmptyState
import app.shkriuss.core.design.ShkErrorState
import app.shkriuss.core.design.ShkLoadingState
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkStateAction
import app.shkriuss.core.design.ShkSwitch

/**
 * The empty state with and without an icon and a button, the loading
 * state, and the error state with and without a button, each also with
 * long text, then a loading and an error state to try. In an app each
 * fills the screen or list it stands in for; here they sit in the page.
 * Only the switch and the button under "Try it" do something when tapped.
 */
@Composable
fun ContentStatesPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_states_title))
        PageIntro(stringResource(R.string.states_intro))

        ComponentHeading(stringResource(R.string.empty_state_title), stringResource(R.string.empty_state_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_with_icon_button) {
                    ShkEmptyState(
                        title = stringResource(R.string.sample_no_notes),
                        body = stringResource(R.string.sample_no_notes_body),
                        icon = painterResource(R.drawable.sample_icon_note),
                        action = ShkStateAction(text = stringResource(R.string.sample_new_note), onClick = {}),
                    )
                },
                ComponentState(R.string.state_without_button) {
                    ShkEmptyState(
                        title = stringResource(R.string.sample_no_results),
                        body = stringResource(R.string.sample_no_results_body),
                        icon = painterResource(R.drawable.sample_icon_search),
                    )
                },
                ComponentState(R.string.state_title_only) {
                    ShkEmptyState(title = stringResource(R.string.sample_nothing_due))
                },
                ComponentState(R.string.state_long_text) {
                    ShkEmptyState(
                        title = stringResource(R.string.sample_long_empty_title),
                        body = stringResource(R.string.sample_long_empty_body),
                        icon = painterResource(R.drawable.sample_icon_note),
                        action = ShkStateAction(text = stringResource(R.string.sample_new_note), onClick = {}),
                    )
                },
            ),
        )

        ComponentHeading(stringResource(R.string.loading_state_title), stringResource(R.string.loading_state_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_loading) {
                    ShkLoadingState(text = stringResource(R.string.sample_loading_notes))
                },
                ComponentState(R.string.state_long_text) {
                    ShkLoadingState(text = stringResource(R.string.sample_long_loading))
                },
            ),
        )

        ComponentHeading(stringResource(R.string.error_state_title), stringResource(R.string.error_state_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_with_button) {
                    ShkErrorState(
                        title = stringResource(R.string.sample_backup_error),
                        body = stringResource(R.string.sample_backup_error_body),
                        action = ShkStateAction(text = stringResource(R.string.sample_try_again), onClick = {}),
                    )
                },
                ComponentState(R.string.state_without_button) {
                    ShkErrorState(
                        title = stringResource(R.string.sample_load_error),
                        body = stringResource(R.string.sample_load_error_body),
                    )
                },
                ComponentState(R.string.state_long_text) {
                    ShkErrorState(
                        title = stringResource(R.string.sample_long_error_title),
                        body = stringResource(R.string.sample_long_error_body),
                        action = ShkStateAction(text = stringResource(R.string.sample_try_again), onClick = {}),
                    )
                },
                ComponentState(R.string.state_try_states) { StatesToTry() },
            ),
        )
    }
}

/**
 * An error state that turns into a loading state, as a screen does when
 * it tries again. "Try again" and the switch show the loading state; the
 * switch shows the error again. TalkBack announces each state as it
 * appears, so the owner can hear the announcements on a phone.
 */
@Composable
private fun StatesToTry() {
    var loading by rememberSaveable { mutableStateOf(false) }
    Column {
        ShkSwitch(
            text = stringResource(R.string.sample_show_loading),
            checked = loading,
            onCheckedChange = { loading = it },
        )
        if (loading) {
            ShkLoadingState(text = stringResource(R.string.sample_try_loading))
        } else {
            ShkErrorState(
                title = stringResource(R.string.sample_try_error),
                body = stringResource(R.string.sample_try_error_body),
                action = ShkStateAction(text = stringResource(R.string.sample_try_again), onClick = { loading = true }),
            )
        }
    }
}
