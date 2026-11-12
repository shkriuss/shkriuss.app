package app.shkriuss.core.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier

/**
 * One screen: its background, its [ShkTopBar], and its content inside the
 * screen margins. Every screen of every app is one, so apps never need
 * Material 3 directly.
 *
 * [topBar] is optional. Pass a [ShkTopBar]. It stays at the top while the
 * content scrolls.
 *
 * It keeps the bar and the content clear of the system bars and the
 * camera cut-out, and uses the screen margin from
 * [ShkSpacing.screenMargin] for the width it is given: 16dp when narrower
 * than 600dp, 24dp from 600dp. In one pane of a [ShkListDetailScaffold],
 * the pane is the screen, so a narrow pane takes the narrow margin.
 *
 * With [scrollable], content taller than the space scrolls, margins and
 * all. Use it for any screen whose content can outgrow the window at font
 * scale 2.0.
 */
@Composable
fun ShkScreen(
    modifier: Modifier = Modifier,
    topBar: (@Composable () -> Unit)? = null,
    scrollable: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = ShkTheme.colors
    CompositionLocalProvider(LocalContentColor provides colors.text) {
        Column(
            modifier = modifier
                .fillMaxSize()
                .background(colors.background),
        ) {
            if (topBar != null) {
                Box(Modifier.fillMaxWidth().windowInsetsPadding(TopBarInsets)) { topBar() }
            }
            BoxWithConstraints(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    // The top bar already keeps clear of the status bar.
                    // The sides still apply to the content.
                    .then(
                        if (topBar != null) {
                            Modifier.consumeWindowInsets(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
                        } else {
                            Modifier
                        },
                    )
                    .safeDrawingPadding(),
            ) {
                val margin = ShkSpacing.screenMargin(maxWidth)
                val scroll = if (scrollable) Modifier.verticalScroll(rememberScrollState()) else Modifier
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .then(scroll)
                        .padding(margin),
                    content = content,
                )
            }
        }
    }
}

/** The insets a top bar keeps clear of: the status bar and cut-outs at the top and sides. */
private val TopBarInsets: WindowInsets
    @Composable
    get() = WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)
