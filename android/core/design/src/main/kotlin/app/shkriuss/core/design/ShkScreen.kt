package app.shkriuss.core.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * The background and margins of a whole screen. Apps use it so they never
 * need Material 3 directly.
 *
 * It keeps content clear of the system bars and uses the margins from
 * ADR 0017: 16dp on phones, 24dp from 600dp wide (tablets and phones in
 * landscape).
 *
 * This is a stub from Phase 0. Phase 1 replaces it with the adaptive
 * scaffold.
 */
@Composable
fun ShkScreen(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    BoxWithConstraints(
        modifier = modifier
            .fillMaxSize()
            .background(colors.background)
            .safeDrawingPadding(),
    ) {
        val margin = if (maxWidth >= 600.dp) 24.dp else 16.dp
        CompositionLocalProvider(LocalContentColor provides colors.onBackground) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(margin),
                content = content,
            )
        }
    }
}
