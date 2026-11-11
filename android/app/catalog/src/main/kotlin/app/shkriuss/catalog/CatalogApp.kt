package app.shkriuss.catalog

import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue

/**
 * The pages of the design gallery, in the order the start screen lists
 * them. Phase 1, step 2 adds a page for each batch of components.
 */
enum class CatalogPage(
    /** The page's name, on the start screen and as the page's title. */
    @param:StringRes val title: Int,
    /** One line under the name on the start screen. */
    @param:StringRes val summary: Int,
) {
    Colors(R.string.page_colors_title, R.string.page_colors_summary),
    Type(R.string.page_type_title, R.string.page_type_summary),
    Shape(R.string.page_shape_title, R.string.page_shape_summary),
    Spacing(R.string.page_spacing_title, R.string.page_spacing_summary),
}

/**
 * The whole Catalog app: the start screen, or the page the user opened.
 * Back returns from a page to the start screen.
 *
 * The open page survives rotation and the process being stopped. There is
 * no navigation library in the build yet, so the open page is simply
 * saved state here.
 */
@Composable
fun CatalogApp() {
    var page by rememberSaveable { mutableStateOf<CatalogPage?>(null) }
    BackHandler(enabled = page != null) { page = null }
    when (page) {
        null -> CatalogScreen(onOpenPage = { page = it })
        CatalogPage.Colors -> ColorsPage()
        CatalogPage.Type -> TypePage()
        CatalogPage.Shape -> ShapePage()
        CatalogPage.Spacing -> SpacingPage()
    }
}
