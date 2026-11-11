package app.shkriuss.catalog

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkFilledButton
import app.shkriuss.core.design.ShkIconButton
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkTextButton
import app.shkriuss.core.design.ShkTonalButton

/**
 * The four kinds of button, each in every state: enabled, with an icon,
 * disabled, and with a label long enough to wrap. Pressed and focused
 * states show when the owner touches or focuses a button.
 */
@Composable
fun ButtonsPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_buttons_title))
        PageIntro(stringResource(R.string.buttons_intro))

        ComponentHeading(stringResource(R.string.buttons_filled_title), stringResource(R.string.buttons_filled_use))
        ComponentStates(
            textButtonStates { text, enabled, icon ->
                ShkFilledButton(text = text, onClick = {}, enabled = enabled, icon = icon)
            },
        )

        ComponentHeading(stringResource(R.string.buttons_tonal_title), stringResource(R.string.buttons_tonal_use))
        ComponentStates(
            textButtonStates { text, enabled, icon ->
                ShkTonalButton(text = text, onClick = {}, enabled = enabled, icon = icon)
            },
        )

        ComponentHeading(stringResource(R.string.buttons_text_title), stringResource(R.string.buttons_text_use))
        ComponentStates(
            textButtonStates { text, enabled, icon ->
                ShkTextButton(text = text, onClick = {}, enabled = enabled, icon = icon)
            },
        )

        ComponentHeading(stringResource(R.string.buttons_icon_title), stringResource(R.string.buttons_icon_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_enabled) { SearchButton(enabled = true) },
                ComponentState(R.string.state_disabled) { SearchButton(enabled = false) },
            ),
        )
    }
}

/**
 * The states every button with text is shown in. [button] draws one kind
 * of button with the text, enabled or not, and the optional icon.
 */
private fun textButtonStates(
    button: @Composable (text: String, enabled: Boolean, icon: Painter?) -> Unit,
): List<ComponentState> = listOf(
    ComponentState(R.string.state_enabled) {
        button(stringResource(R.string.sample_save), true, null)
    },
    ComponentState(R.string.state_with_icon) {
        button(stringResource(R.string.sample_add), true, painterResource(R.drawable.sample_icon_add))
    },
    ComponentState(R.string.state_disabled) {
        button(stringResource(R.string.sample_save), false, null)
    },
    ComponentState(R.string.state_long_label) {
        button(stringResource(R.string.sample_long_button), true, null)
    },
)

/** The sample icon button. TalkBack reads "Search". */
@Composable
private fun SearchButton(enabled: Boolean) {
    ShkIconButton(
        icon = painterResource(R.drawable.sample_icon_search),
        contentDescription = stringResource(R.string.sample_search),
        onClick = {},
        enabled = enabled,
    )
}
