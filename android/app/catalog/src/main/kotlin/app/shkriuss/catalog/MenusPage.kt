package app.shkriuss.catalog

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
import app.shkriuss.core.design.ShkInPlace
import app.shkriuss.core.design.ShkMenuInPlace
import app.shkriuss.core.design.ShkMenuItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.ShkTopBarAction

/**
 * The menu with text only, with icons, with a row turned off, with a row
 * that deletes and with long text, each drawn in place as it looks when
 * open. Then one to try: a top bar whose More options button opens its
 * menu. Only that top bar does something when tapped.
 */
@OptIn(ShkInPlace::class)
@Composable
fun MenusPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_menus_title))
        PageIntro(stringResource(R.string.menus_intro))

        ComponentHeading(stringResource(R.string.menu_title), stringResource(R.string.menu_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_text_only) {
                    ShkMenuInPlace(
                        listOf(
                            menuItem(R.string.sample_rename),
                            menuItem(R.string.sample_duplicate),
                            menuItem(R.string.sample_sort_by_date),
                        ),
                    )
                },
                ComponentState(R.string.state_with_icons) {
                    ShkMenuInPlace(
                        listOf(
                            menuItem(R.string.sample_new_note, icon = R.drawable.sample_icon_add),
                            menuItem(R.string.sample_add_reminder, icon = R.drawable.sample_icon_alarm),
                            menuItem(R.string.sample_search, icon = R.drawable.sample_icon_search),
                        ),
                    )
                },
                ComponentState(R.string.state_row_disabled) {
                    ShkMenuInPlace(
                        listOf(
                            menuItem(R.string.sample_rename),
                            menuItem(R.string.sample_duplicate, enabled = false),
                            menuItem(R.string.sample_select_all),
                        ),
                    )
                },
                ComponentState(R.string.state_destructive_row) {
                    ShkMenuInPlace(
                        listOf(
                            menuItem(R.string.sample_rename),
                            menuItem(R.string.sample_duplicate),
                            menuItem(R.string.sample_delete, destructive = true),
                        ),
                    )
                },
                ComponentState(R.string.state_long_text) {
                    ShkMenuInPlace(
                        listOf(
                            menuItem(R.string.sample_long_menu_row, icon = R.drawable.sample_icon_note),
                            menuItem(R.string.sample_add_reminder, icon = R.drawable.sample_icon_alarm),
                        ),
                    )
                },
            ),
            // Each panel keeps its own height, as in its window.
            equalHeights = false,
        )
        Spacer(Modifier.height(ShkSpacing.Large))
        ComponentStates(
            listOf(ComponentState(R.string.state_try_menu) { MenuToTry() }),
            wideColumns = 1,
        )
    }
}

/** A top bar in a frame, with search and a menu, and a line that says which row was tapped. */
@Composable
private fun MenuToTry() {
    var chosen by rememberSaveable { mutableStateOf<Int?>(null) }
    WindowFrame {
        ShkTopBar(
            title = stringResource(R.string.sample_notes),
            actions = listOf(
                ShkTopBarAction(
                    icon = painterResource(R.drawable.sample_icon_search),
                    label = stringResource(R.string.sample_search),
                    onClick = { chosen = R.string.sample_search },
                ),
            ),
            menuItems = listOf(
                ShkMenuItem(text = stringResource(R.string.sample_rename), onClick = { chosen = R.string.sample_rename }),
                ShkMenuItem(text = stringResource(R.string.sample_sort_by_date), onClick = { chosen = R.string.sample_sort_by_date }),
                ShkMenuItem(
                    text = stringResource(R.string.sample_delete),
                    onClick = { chosen = R.string.sample_delete },
                    destructive = true,
                ),
            ),
        )
    }
    Spacer(Modifier.height(ShkSpacing.Small))
    val result = chosen?.let { stringResource(R.string.sample_you_chose, stringResource(it)) }
        ?: stringResource(R.string.sample_no_choice)
    ShkText(text = result, color = ShkTheme.colors.textSecondary)
}

/** A row of a menu sample that does nothing. */
@Composable
private fun menuItem(text: Int, icon: Int? = null, enabled: Boolean = true, destructive: Boolean = false) = ShkMenuItem(
    text = stringResource(text),
    onClick = {},
    icon = icon?.let { painterResource(it) },
    enabled = enabled,
    destructive = destructive,
)
