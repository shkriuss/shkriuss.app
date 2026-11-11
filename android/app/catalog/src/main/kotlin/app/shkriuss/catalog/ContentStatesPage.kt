package app.shkriuss.catalog

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkEmptyState
import app.shkriuss.core.design.ShkErrorState
import app.shkriuss.core.design.ShkLoadingState
import app.shkriuss.core.design.ShkScreen

/**
 * The empty state with and without an icon and a button, the loading
 * state, and the error state with and without a button, each also with
 * long text. In an app each fills the screen or list it stands in for;
 * here they sit in the page. Their buttons do nothing when tapped.
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
                        actionText = stringResource(R.string.sample_new_note),
                        onAction = {},
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
                        actionText = stringResource(R.string.sample_new_note),
                        onAction = {},
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
                        actionText = stringResource(R.string.sample_try_again),
                        onAction = {},
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
                        actionText = stringResource(R.string.sample_try_again),
                        onAction = {},
                    )
                },
            ),
        )
    }
}
