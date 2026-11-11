package app.shkriuss.catalog

import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue

/** The groups the start screen lists the pages in, in this order. */
enum class CatalogGroup(
    /** The heading of the group on the start screen. */
    @param:StringRes val title: Int,
) {
    Tokens(R.string.catalog_group_tokens),
    Components(R.string.catalog_group_components),
}

/**
 * The pages of the design gallery, in the order the start screen lists
 * them. Phase 1, step 2 adds pages for each batch of components.
 */
enum class CatalogPage(
    /** The page's name, on the start screen and as the page's title. */
    @param:StringRes val title: Int,
    /** One line under the name on the start screen. */
    @param:StringRes val summary: Int,
    /** The group the start screen lists it in. */
    val group: CatalogGroup,
) {
    Colors(R.string.page_colors_title, R.string.page_colors_summary, CatalogGroup.Tokens),
    Type(R.string.page_type_title, R.string.page_type_summary, CatalogGroup.Tokens),
    Shape(R.string.page_shape_title, R.string.page_shape_summary, CatalogGroup.Tokens),
    Spacing(R.string.page_spacing_title, R.string.page_spacing_summary, CatalogGroup.Tokens),
    Buttons(R.string.page_buttons_title, R.string.page_buttons_summary, CatalogGroup.Components),
    FloatingActionButtons(R.string.page_fab_title, R.string.page_fab_summary, CatalogGroup.Components),
    Chips(R.string.page_chips_title, R.string.page_chips_summary, CatalogGroup.Components),
    TextFields(R.string.page_text_fields_title, R.string.page_text_fields_summary, CatalogGroup.Components),
    SelectionControls(R.string.page_selection_title, R.string.page_selection_summary, CatalogGroup.Components),
    Sliders(R.string.page_sliders_title, R.string.page_sliders_summary, CatalogGroup.Components),
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
        CatalogPage.Buttons -> ButtonsPage()
        CatalogPage.FloatingActionButtons -> FloatingActionButtonsPage()
        CatalogPage.Chips -> ChipsPage()
        CatalogPage.TextFields -> TextFieldsPage()
        CatalogPage.SelectionControls -> SelectionControlsPage()
        CatalogPage.Sliders -> SlidersPage()
    }
}
