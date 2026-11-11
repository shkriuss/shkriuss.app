package app.shkriuss.catalog

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkShapes
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTheme

/**
 * The start screen of the design gallery: its title and one button for
 * each page, under the heading of its group. Tapping a button calls
 * [onOpenPage].
 */
@Composable
fun CatalogScreen(onOpenPage: (CatalogPage) -> Unit, modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.catalog_title))
        PageIntro(stringResource(R.string.catalog_intro))
        CatalogGroup.entries.forEach { group ->
            SectionHeading(stringResource(group.title))
            AdaptiveGrid(items = CatalogPage.entries.filter { it.group == group }, wideColumns = 2) { page, itemModifier ->
                PageButton(page = page, onClick = { onOpenPage(page) }, modifier = itemModifier)
            }
        }
    }
}

/**
 * A raised surface with a page's name and summary. The whole surface is
 * one button, at least 48dp tall, and TalkBack reads both lines.
 */
@Composable
private fun PageButton(page: CatalogPage, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = ShkTheme.colors
    Column(
        modifier = modifier
            .heightIn(min = ShkSpacing.MinTouchTarget)
            .clip(ShkShapes.Card)
            .background(colors.surface)
            .border(1.dp, colors.outline, ShkShapes.Card)
            .clickable(
                role = Role.Button,
                onClickLabel = stringResource(R.string.catalog_open_page),
                onClick = onClick,
            )
            .padding(ShkSpacing.Large),
        verticalArrangement = Arrangement.spacedBy(ShkSpacing.ExtraSmall),
    ) {
        ShkText(text = stringResource(page.title), style = ShkTextStyle.Subtitle)
        ShkText(
            text = stringResource(page.summary),
            color = colors.textSecondary,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
