package app.shkriuss.core.design

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.movableContentOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * A list of items and the detail of one of them, such as notes and the
 * open note. It switches by the width of the window (CLAUDE.md, "UI and
 * accessibility"):
 *
 * - Narrower than 840dp ([ShkWindowWidth.Compact] and
 *   [ShkWindowWidth.Medium]): one pane. It shows [list], or [detail] in
 *   its place while [detailOpen] is true.
 * - 840dp and wider ([ShkWindowWidth.Expanded]): two panes. [list] is on
 *   the start side, 360dp wide, and [detail] fills the rest, with a line
 *   in the divider colour between them.
 *
 * Use it for any screen where people pick one item from a list to see or
 * change it. Each pane is a screen of its own: give each a [ShkScreen]
 * with a [ShkTopBar].
 *
 * [detail] is given what Back does. In one pane it is [onCloseDetail]:
 * pass it to the detail's [ShkTopBar] as `onBack`. The system back gesture
 * calls [onCloseDetail] too. In two panes it is null, because the list is
 * already beside the detail, so the top bar shows no Back button and the
 * back gesture leaves the screen as usual.
 *
 * In two panes [detail] is always shown. While [detailOpen] is false, show
 * a [ShkEmptyState] in it that says what to do, such as "Choose a note".
 * Key the detail of each item by the item, with `key`, so each item opens
 * at its top. Mark the open item in the list with `selected` on its
 * [ShkListItem], so people see which item the detail belongs to.
 *
 * The list keeps its scroll position and other saved state while the
 * detail covers it. Both panes keep their state when the window changes
 * between one pane and two. A detail that was closed starts fresh when it
 * opens again. [windowWidth] is the window's class; leave it out. The Catalog passes it
 * to show one pane and two side by side.
 */
@Composable
fun ShkListDetailScaffold(
    detailOpen: Boolean,
    onCloseDetail: () -> Unit,
    list: @Composable () -> Unit,
    detail: @Composable (onBack: (() -> Unit)?) -> Unit,
    modifier: Modifier = Modifier,
    windowWidth: ShkWindowWidth = ShkWindowWidth.current,
) {
    val twoPanes = windowWidth == ShkWindowWidth.Expanded
    BackHandler(enabled = detailOpen && !twoPanes, onBack = onCloseDetail)
    // Both panes move, with all their state, when the window changes
    // between one pane and two. The list's saved state is also kept while
    // the detail covers it. The detail's is not kept once it closes, so
    // the next item opens fresh.
    val listState = rememberSaveableStateHolder()
    val currentList by rememberUpdatedState(list)
    val currentDetail by rememberUpdatedState(detail)
    val movableList = remember(listState) {
        movableContentOf { listState.SaveableStateProvider(ListKey) { currentList() } }
    }
    val movableDetail = remember { movableContentOf { onBack: (() -> Unit)? -> currentDetail(onBack) } }
    if (twoPanes) {
        Row(modifier.fillMaxSize()) {
            // Each pane keeps clear of the cut-outs and system bars on its
            // own side of the window only.
            Box(
                Modifier
                    .width(ListPaneWidth)
                    .fillMaxHeight()
                    .consumeWindowInsets(WindowInsets.safeDrawing.only(WindowInsetsSides.End))
                    .lineOnEdge(LineEdge.End, ShkTheme.colors.divider),
            ) {
                movableList()
            }
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .consumeWindowInsets(WindowInsets.safeDrawing.only(WindowInsetsSides.Start)),
            ) {
                movableDetail(null)
            }
        }
    } else {
        Box(modifier.fillMaxSize()) {
            if (detailOpen) {
                movableDetail(onCloseDetail)
            } else {
                movableList()
            }
        }
    }
}

/**
 * The width of the list pane beside the detail, as in Material 3's
 * list-and-detail layout. It is about the width of a phone, so a list
 * looks the same there as on a phone.
 */
private val ListPaneWidth = 360.dp

/** The key the list's saved state is kept under while it is not shown. */
private const val ListKey = "list"
