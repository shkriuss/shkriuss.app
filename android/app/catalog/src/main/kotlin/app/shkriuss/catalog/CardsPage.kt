package app.shkriuss.catalog

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkCard
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextButton
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTheme

/**
 * The card that cannot be tapped, alone and with a button, and the card
 * that can be tapped, with short and long text. The pressed state shows
 * when the owner touches a card that can be tapped. Nothing here does
 * anything when tapped.
 */
@Composable
fun CardsPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_cards_title))
        PageIntro(stringResource(R.string.cards_intro))

        ComponentHeading(stringResource(R.string.card_title), stringResource(R.string.card_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_not_tappable) {
                    ShkCard { NoteText(R.string.sample_card_title, R.string.sample_card_text) }
                },
                ComponentState(R.string.state_not_tappable_button) {
                    ShkCard {
                        NoteText(R.string.sample_card_title, R.string.sample_card_text)
                        Spacer(Modifier.height(ShkSpacing.Small))
                        ShkTextButton(text = stringResource(R.string.sample_edit), onClick = {})
                    }
                },
                ComponentState(R.string.state_tappable) {
                    ShkCard(onClick = {}) { NoteText(R.string.sample_card_title, R.string.sample_card_text) }
                },
                ComponentState(R.string.state_long_text) {
                    ShkCard(onClick = {}) { NoteText(R.string.sample_long_card_title, R.string.sample_long_card_text) }
                },
            ),
        )
    }
}

/** The title and the first lines of a sample note, as a card in a notes app shows them. */
@Composable
private fun NoteText(@StringRes title: Int, @StringRes text: Int) {
    ShkText(text = stringResource(title), style = ShkTextStyle.Subtitle)
    Spacer(Modifier.height(ShkSpacing.ExtraSmall))
    ShkText(text = stringResource(text), color = ShkTheme.colors.textSecondary)
}
