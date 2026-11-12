package app.shkriuss.catalog

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkBottomSheet
import app.shkriuss.core.design.ShkBottomSheetInPlace
import app.shkriuss.core.design.ShkInPlace
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTonalButton

/**
 * The bottom sheet with a title, without one and with long text, each
 * drawn in place as it looks when open. Then one to try, which slides up
 * in its window. Only the button under "Try it" does something when
 * tapped.
 */
@OptIn(ShkInPlace::class)
@Composable
fun BottomSheetsPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_sheets_title))
        PageIntro(stringResource(R.string.sheets_intro))

        ComponentHeading(stringResource(R.string.sheet_title), stringResource(R.string.sheet_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_with_title) {
                    ShkBottomSheetInPlace(title = stringResource(R.string.sample_card_title)) {
                        SheetActions(onChoose = {})
                    }
                },
                ComponentState(R.string.state_without_title) {
                    ShkBottomSheetInPlace {
                        SheetRow(R.string.sample_add_reminder, R.drawable.sample_icon_alarm, R.string.sample_reminder_supporting) {}
                        SheetRow(R.string.sample_duplicate, R.drawable.sample_icon_note, R.string.sample_duplicate_supporting) {}
                    }
                },
                ComponentState(R.string.state_long_text) {
                    ShkBottomSheetInPlace(title = stringResource(R.string.sample_long_sheet_title)) {
                        SheetRow(R.string.sample_long_sheet_row, R.drawable.sample_icon_note, R.string.sample_long_sheet_supporting) {}
                        SheetRow(R.string.sample_add_reminder, R.drawable.sample_icon_alarm) {}
                    }
                },
                ComponentState(R.string.state_try_sheet) { SheetToTry() },
            ),
            wideColumns = 2,
            // Each panel keeps its own height, as in its window.
            equalHeights = false,
        )
    }
}

/** A button that opens the sheet, and a line that says what was chosen in it. */
@Composable
private fun SheetToTry() {
    var open by rememberSaveable { mutableStateOf(false) }
    var chosen by rememberSaveable { mutableStateOf<Int?>(null) }
    var closedWithoutChoosing by rememberSaveable { mutableStateOf(false) }
    ShkTonalButton(text = stringResource(R.string.sample_open_sheet), onClick = { open = true })
    Spacer(Modifier.height(ShkSpacing.Small))
    val result = when {
        closedWithoutChoosing -> stringResource(R.string.sample_sheet_closed)
        chosen != null -> stringResource(R.string.sample_you_chose, stringResource(chosen!!))
        else -> stringResource(R.string.sample_no_choice)
    }
    ShkText(text = result, color = ShkTheme.colors.textSecondary)
    if (open) {
        ShkBottomSheet(
            title = stringResource(R.string.sample_card_title),
            onDismissRequest = {
                open = false
                closedWithoutChoosing = true
            },
        ) {
            // A row closes the sheet by no longer showing it.
            SheetActions(
                onChoose = { choice ->
                    chosen = choice
                    closedWithoutChoosing = false
                    open = false
                },
            )
        }
    }
}

/** Three actions on a note, as rows with icons. [onChoose] gets the words of the row tapped. */
@Composable
private fun SheetActions(onChoose: (Int) -> Unit) {
    SheetRow(R.string.sample_add_reminder, R.drawable.sample_icon_alarm) { onChoose(R.string.sample_add_reminder) }
    SheetRow(R.string.sample_duplicate, R.drawable.sample_icon_note) { onChoose(R.string.sample_duplicate) }
    SheetRow(R.string.sample_search, R.drawable.sample_icon_search) { onChoose(R.string.sample_search) }
}

/** One action in a sheet: a tappable list item with an icon, and an optional second line. */
@Composable
private fun SheetRow(@StringRes text: Int, icon: Int, @StringRes supporting: Int? = null, onClick: () -> Unit) {
    ShkListItem(
        headline = stringResource(text),
        supportingText = supporting?.let { stringResource(it) },
        icon = painterResource(icon),
        onClick = onClick,
    )
}
