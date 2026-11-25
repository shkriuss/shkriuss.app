package app.shkriuss.catalog

import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkDivider
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.R as DesignR

/**
 * The list item in every state, with a tick box and a small image too, the section header alone, long and above
 * list items, and the divider between list items. The pressed state shows
 * when the owner touches a list item that can be tapped. Nothing here does
 * anything when tapped.
 */
@Composable
fun ListsPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_lists_title))
        PageIntro(stringResource(R.string.lists_intro))

        ComponentHeading(stringResource(R.string.list_item_title), stringResource(R.string.list_item_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_one_line) {
                    ShkListItem(headline = stringResource(R.string.sample_buy_bread))
                },
                ComponentState(R.string.state_with_supporting_text) {
                    ShkListItem(
                        headline = stringResource(R.string.sample_buy_bread),
                        supportingText = stringResource(R.string.sample_corner_shop),
                    )
                },
                ComponentState(R.string.state_with_icon) {
                    ShkListItem(
                        headline = stringResource(R.string.sample_daily_reminder),
                        supportingText = stringResource(R.string.sample_every_day),
                        icon = painterResource(R.drawable.sample_icon_alarm),
                    )
                },
                ComponentState(R.string.state_with_trailing_text) {
                    ShkListItem(
                        headline = stringResource(R.string.sample_call_dentist),
                        trailingText = stringResource(R.string.sample_time),
                    )
                },
                ComponentState(R.string.state_tappable) {
                    ShkListItem(
                        headline = stringResource(R.string.sample_buy_bread),
                        supportingText = stringResource(R.string.sample_corner_shop),
                        onClick = {},
                    )
                },
                ComponentState(R.string.state_disabled) {
                    ShkListItem(
                        headline = stringResource(R.string.sample_buy_bread),
                        supportingText = stringResource(R.string.sample_corner_shop),
                        onClick = {},
                        enabled = false,
                    )
                },
                ComponentState(R.string.state_selected_open) {
                    ShkListItem(
                        headline = stringResource(R.string.sample_buy_bread),
                        supportingText = stringResource(R.string.sample_corner_shop),
                        onClick = {},
                        selected = true,
                    )
                },
                ComponentState(R.string.state_long_text) {
                    ShkListItem(
                        headline = stringResource(R.string.sample_long_list_headline),
                        supportingText = stringResource(R.string.sample_long_list_supporting),
                        trailingText = stringResource(R.string.sample_time),
                        icon = painterResource(R.drawable.sample_icon_alarm),
                        onClick = {},
                    )
                },
                // The icon at the end is decorative: the text says what it shows.
                ComponentState(R.string.state_with_trailing_icon) {
                    ShkListItem(
                        headline = stringResource(R.string.sample_call_dentist),
                        trailingText = stringResource(R.string.sample_done),
                        trailingIcon = painterResource(DesignR.drawable.shk_icon_check),
                    )
                },
                // The box is its own touch target, beside the row's tap. As everything here, it changes nothing when tapped.
                ComponentState(R.string.state_with_tick_box) {
                    ShkListItem(
                        headline = stringResource(R.string.sample_buy_bread),
                        supportingText = stringResource(R.string.sample_corner_shop),
                        onClick = {},
                        checked = false,
                        onCheckedChange = {},
                    )
                },
                ComponentState(R.string.state_with_tick_box_ticked) {
                    ShkListItem(
                        headline = stringResource(R.string.sample_call_dentist),
                        supportingText = stringResource(R.string.sample_done),
                        onClick = {},
                        checked = true,
                        onCheckedChange = {},
                    )
                },
                // The image is drawn as it is, not tinted, as the image of a file in a note.
                ComponentState(R.string.state_with_image) {
                    ShkListItem(
                        headline = stringResource(R.string.sample_file_name),
                        supportingText = stringResource(R.string.sample_file_size),
                        onClick = {},
                        image = rememberSamplePhoto(),
                    )
                },
            ),
        )

        ComponentHeading(stringResource(R.string.section_header_title), stringResource(R.string.section_header_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_one_line) { ShkSectionHeader(stringResource(R.string.sample_today)) },
                ComponentState(R.string.state_long_text) { ShkSectionHeader(stringResource(R.string.sample_long_header)) },
                ComponentState(R.string.state_above_list_items) { TasksByDay() },
            ),
        )

        ComponentHeading(stringResource(R.string.divider_title), stringResource(R.string.divider_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_between_list_items) { TasksWithDividers() },
            ),
        )
    }
}

/** Two days of tasks, each under its section header, as a tasks app shows them. */
@Composable
private fun TasksByDay() {
    Column {
        ShkSectionHeader(stringResource(R.string.sample_today))
        ShkListItem(headline = stringResource(R.string.sample_buy_bread), trailingText = stringResource(R.string.sample_time))
        ShkListItem(headline = stringResource(R.string.sample_call_dentist))
        ShkSectionHeader(stringResource(R.string.sample_tomorrow))
        ShkListItem(headline = stringResource(R.string.sample_water_plants))
    }
}

/** Three tasks with a divider between each two. */
@Composable
private fun TasksWithDividers() {
    Column {
        ShkListItem(headline = stringResource(R.string.sample_buy_bread))
        ShkDivider()
        ShkListItem(headline = stringResource(R.string.sample_call_dentist))
        ShkDivider()
        ShkListItem(headline = stringResource(R.string.sample_water_plants))
    }
}

/**
 * A small picture drawn in code, as a photo of a file would be: a sky, a
 * sun and a hill. Catalog has no image of its own to show, and needs no
 * bitmap for it.
 */
@Composable
private fun rememberSamplePhoto(): Painter = remember { SamplePhoto() }

/** The sample picture: a sky, a sun and a hill, drawn at any size. */
private class SamplePhoto : Painter() {
    override val intrinsicSize: Size = Size(PHOTO_SIDE.toFloat(), PHOTO_SIDE.toFloat())

    override fun DrawScope.onDraw() {
        drawRect(Color(SKY))
        drawCircle(Color(SUN), radius = size.minDimension / 6, center = Offset(size.width * 0.7f, size.height * 0.3f))
        drawCircle(Color(HILL), radius = size.minDimension * 0.6f, center = Offset(size.width * 0.3f, size.height * 1.2f))
    }
}

/** The side of the sample picture as drawn by itself, in pixels. The row draws it at its own size. */
private const val PHOTO_SIDE = 96

/** The colours of the sample picture: a sky, a sun and a hill. */
private const val SKY = 0xFF7EC8E3
private const val SUN = 0xFFFFD54F
private const val HILL = 0xFF4CAF50
