package app.shkriuss.catalog

import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkCard
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.security.FirstNeedForm
import app.shkriuss.core.security.RecoveryKeyFirstNeedSample
import app.shkriuss.core.security.SecurityScreenSamples

/** The forms of the first-need dialog that the page shows, in this order. */
enum class FirstNeedSample(@param:StringRes val title: Int, val form: FirstNeedForm) {
    Backup(R.string.sample_first_need_backup, FirstNeedForm.SET_UP_FOR_BACKUP),
    AppLock(R.string.sample_first_need_app_lock, FirstNeedForm.SET_UP_FOR_APP_LOCK),
    Restore(R.string.sample_first_need_restore, FirstNeedForm.ENTER_FOR_RESTORE),
    Finish(R.string.sample_first_need_finish, FirstNeedForm.FINISH),
}

/**
 * The dialog of `core/security` for the moment the recovery key is first
 * needed (ADR 0035), in each of its forms, drawn in place. An app shows it
 * before a backup, a restore or the app lock while it has no recovery key.
 * Catalog holds no keys, so nothing here opens a screen of the recovery
 * key. The dialog shows no recovery words, so the page has no switch to
 * protect it.
 */
@Composable
fun RecoveryKeyFirstNeedPage(modifier: Modifier = Modifier) {
    var open by rememberSaveable { mutableStateOf<FirstNeedSample?>(null) }
    val sample = open
    if (sample != null) {
        BackHandler { open = null }
        Sample(sample, onBack = { open = null }, modifier = modifier)
    } else {
        ShkScreen(modifier = modifier, scrollable = true) {
            PageTitle(stringResource(R.string.page_first_need_title))
            PageIntro(stringResource(R.string.first_need_intro))
            SectionHeading(stringResource(R.string.first_need_forms_heading))
            ShkCard {
                FirstNeedSample.entries.forEach { entry ->
                    ShkListItem(headline = stringResource(entry.title), onClick = { open = entry })
                }
            }
        }
    }
}

/** One form of the dialog, drawn in place on a screen of its own. */
@OptIn(SecurityScreenSamples::class)
@Composable
private fun Sample(sample: FirstNeedSample, onBack: () -> Unit, modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true, topBar = { ShkTopBar(title = stringResource(sample.title), onBack = onBack) }) {
        RecoveryKeyFirstNeedSample(sample.form)
    }
}
