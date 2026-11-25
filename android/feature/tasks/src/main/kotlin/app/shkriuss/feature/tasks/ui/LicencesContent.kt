package app.shkriuss.feature.tasks.ui

import androidx.activity.compose.BackHandler
import androidx.annotation.RawRes
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkEmptyState
import app.shkriuss.core.design.ShkListDetailScaffold
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.ShkWindowWidth
import app.shkriuss.feature.tasks.LicensedPart
import app.shkriuss.feature.tasks.Licences
import app.shkriuss.feature.tasks.R

/**
 * Licences (docs/apps/water/spec.md, "Licences", as
 * docs/apps/tasks/spec.md, "As in Water and Reminders", says): a list of
 * every third-party part that ships in Tasks, by name. A tap shows that
 * part's notice and the full text of its licence. Below 840dp the notice
 * opens in place of the list, with Back; from 840dp it opens beside the
 * list, as an open list does beside Lists.
 *
 * Settings opens it in its own place. [onBack] goes back to Settings. Back
 * closes an open notice first, below 840dp.
 */
@Composable
internal fun LicencesContent(onBack: () -> Unit, windowWidth: ShkWindowWidth = ShkWindowWidth.current) {
    var openId by rememberSaveable { mutableStateOf<String?>(null) }
    val open = Licences.part(openId)
    // Before the scaffold, so that its own Back, which closes an open notice, comes first.
    BackHandler(onBack = onBack)
    ShkListDetailScaffold(
        detailOpen = open != null,
        onCloseDetail = { openId = null },
        list = { PartList(openId, onOpen = { openId = it.id }, onBack = onBack) },
        detail = { onCloseNotice ->
            if (open == null) {
                ShkScreen { ShkEmptyState(title = stringResource(R.string.tasks_choose_a_part), modifier = Modifier.weight(1f)) }
            } else {
                // Each part opens at its top, also beside the list, where the pane stays while another part opens.
                key(open.id) { PartNotice(open, onCloseNotice) }
            }
        },
        windowWidth = windowWidth,
    )
}

/** The list of parts: each with its name, and the name of its licence under it. */
@Composable
private fun PartList(openId: String?, onOpen: (LicensedPart) -> Unit, onBack: () -> Unit) {
    ShkScreen(topBar = { ShkTopBar(title = stringResource(R.string.tasks_licences), onBack = onBack) }) {
        ShkText(
            text = stringResource(R.string.tasks_licences_intro),
            color = ShkTheme.colors.textSecondary,
            modifier = Modifier.padding(bottom = ShkSpacing.Small),
        )
        LazyColumn(Modifier.fillMaxSize()) {
            items(Licences.parts, key = { it.id }) { part ->
                ShkListItem(
                    headline = stringResource(part.name),
                    supportingText = stringResource(part.licence),
                    onClick = { onOpen(part) },
                    selected = part.id == openId,
                )
            }
        }
    }
}

/** One part: its notice, then the full text of its licence. The whole of it scrolls. */
@Composable
private fun PartNotice(part: LicensedPart, onBack: (() -> Unit)?) {
    ShkScreen(topBar = { ShkTopBar(title = stringResource(part.name), onBack = onBack) }, scrollable = true) {
        ShkSectionHeader(stringResource(R.string.tasks_licence_notice))
        ShkText(text = rawText(part.notice))
        ShkSectionHeader(stringResource(part.licence))
        ShkText(text = rawText(part.text))
    }
}

/** The text of the raw resource [id], as it is in the app: a notice or a licence, never translated. */
@Composable
private fun rawText(@RawRes id: Int): String {
    val resources = LocalResources.current
    return remember(id, resources) { resources.openRawResource(id).bufferedReader().use { it.readText() }.trimEnd() }
}
