package app.shkriuss.catalog

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.layout
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.constrainWidth
import androidx.compose.ui.unit.offset
import app.shkriuss.core.design.ShkDestination
import app.shkriuss.core.design.ShkNavigationScaffold
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.ShkWindowWidth

/**
 * The navigation bar and the navigation rail, each with short labels and
 * with a long one, then one to try. Each sample is in a frame that stands
 * for a window. The samples are drawn for a fixed window width, so the bar
 * and the rail show side by side; the one to try follows the window. Only
 * the one to try does something when tapped.
 */
@Composable
fun NavigationPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_navigation_title))
        PageIntro(stringResource(R.string.navigation_intro))

        ComponentHeading(stringResource(R.string.navigation_title), stringResource(R.string.navigation_use))
        ComponentStates(
            listOf(
                ComponentState(R.string.state_bar) { NavigationSample(ShkWindowWidth.Compact, longLabel = false) },
                ComponentState(R.string.state_rail) { NavigationSample(ShkWindowWidth.Medium, longLabel = false) },
                ComponentState(R.string.state_bar_long_label) { NavigationSample(ShkWindowWidth.Compact, longLabel = true) },
                ComponentState(R.string.state_rail_long_label) { NavigationSample(ShkWindowWidth.Medium, longLabel = true) },
            ),
            wideColumns = 2,
        )
        Spacer(Modifier.height(ShkSpacing.Large))
        ComponentStates(listOf(ComponentState(R.string.state_try_navigation) { NavigationToTry() }), wideColumns = 1)
    }
}

/**
 * The bar or the rail, for [windowWidth], with the first destination
 * selected. With [longLabel], the second destination's label is long.
 * Taps do nothing.
 */
@Composable
private fun NavigationSample(windowWidth: ShkWindowWidth, longLabel: Boolean) {
    val destinations = sampleDestinations(longLabel)
    WindowFrame {
        ShkNavigationScaffold(
            destinations = destinations,
            selectedIndex = 0,
            onSelect = {},
            windowWidth = windowWidth,
        ) {
            DestinationScreen(destinations[0].label)
        }
    }
}

/**
 * A bar or a rail that follows the window, as in an app. A tap on a
 * destination selects it and shows its name in the top bar.
 */
@Composable
private fun NavigationToTry() {
    var selected by rememberSaveable { mutableIntStateOf(0) }
    val destinations = sampleDestinations(longLabel = false)
    WindowFrame {
        ShkNavigationScaffold(
            destinations = destinations,
            selectedIndex = selected,
            onSelect = { selected = it },
        ) {
            DestinationScreen(destinations[selected].label)
        }
    }
}

/** Today, Notes and Search, or a long label in place of Notes. */
@Composable
private fun sampleDestinations(longLabel: Boolean): List<ShkDestination> = listOf(
    ShkDestination(stringResource(R.string.sample_today), painterResource(R.drawable.sample_icon_alarm)),
    ShkDestination(
        stringResource(if (longLabel) R.string.sample_long_destination else R.string.sample_notes),
        painterResource(R.drawable.sample_icon_note),
    ),
    ShkDestination(stringResource(R.string.sample_search), painterResource(R.drawable.sample_icon_search)),
)

/**
 * The top of a destination's screen: its top bar and a line of text in
 * the screen margins. It is as tall as its content, so a frame around it
 * needs no fixed height, and a row of frames can be made equally tall.
 */
@Composable
private fun DestinationScreen(title: String) {
    Column {
        ShkTopBar(title = title)
        ShkText(
            text = stringResource(R.string.sample_destination_body),
            color = ShkTheme.colors.textSecondary,
            modifier = Modifier
                .screenMargins()
                .padding(bottom = ShkSpacing.ExtraLarge),
        )
    }
}

/**
 * Pads both sides by the screen margin for the width given, as a screen
 * does. It reads the width from the constraints, so a row of frames can
 * still ask how tall it is.
 */
private fun Modifier.screenMargins(): Modifier = layout { measurable, constraints ->
    val margin = ShkSpacing.screenMargin(constraints.maxWidth.toDp()).roundToPx()
    val placeable = measurable.measure(constraints.offset(horizontal = -2 * margin))
    layout(constraints.constrainWidth(placeable.width + 2 * margin), placeable.height) {
        placeable.placeRelative(margin, 0)
    }
}
