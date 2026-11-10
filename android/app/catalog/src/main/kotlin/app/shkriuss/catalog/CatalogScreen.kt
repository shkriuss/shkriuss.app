package app.shkriuss.catalog

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextStyle

/**
 * The start screen of the design gallery. In Phase 0 it only shows its
 * title. Phase 1 adds a page for every token and component.
 */
@Composable
fun CatalogScreen(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier) {
        ShkText(
            text = stringResource(R.string.catalog_title),
            style = ShkTextStyle.Headline,
            modifier = Modifier.semantics { heading() },
        )
    }
}
