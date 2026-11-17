package app.shkriuss.reminders

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.captureScreenRoboImage

/**
 * Captures the whole of a scrolling screen, one window at a time, so a
 * long screen is checked to its end, at font scale 2.0 too. A copy of
 * Water's. It also takes a screen with no part that scrolls, or with two
 * panes that each scroll on their own: it is captured once.
 *
 * The first image is `<name>_<config>.png`. If the screen scrolls, it
 * scrolls down by one window less an overlap and captures
 * `<name>_<config>_part2.png`, and so on to the end.
 */
fun ComposeTestRule.captureWholeScreen(name: String, config: ScreenshotConfig) {
    val scrollers = onAllNodes(hasScrollAction() and !hasAnyAncestor(hasScrollAction())).fetchSemanticsNodes()
    var part = 1
    onRoot().captureRoboImage(path(name, config, part))
    if (scrollers.size != 1) return
    val scroller = onNode(hasScrollAction() and !hasAnyAncestor(hasScrollAction()))
    while (true) {
        val node = scroller.fetchSemanticsNode()
        val range = node.config[SemanticsProperties.VerticalScrollAxisRange]
        if (range.value() >= range.maxValue()) return
        val step = node.size.height - with(density) { OVERLAP.toPx() }
        scroller.performSemanticsAction(SemanticsActions.ScrollBy) { scrollBy -> scrollBy(0f, step) }
        waitForIdle()
        part++
        check(part <= MAX_PARTS) { "$name is more than $MAX_PARTS windows long in ${config.name}" }
        onRoot().captureRoboImage(path(name, config, part))
    }
}

private fun path(name: String, config: ScreenshotConfig, part: Int): String {
    val suffix = if (part == 1) "" else "_part$part"
    return "src/test/screenshots/${name}_${config.name}$suffix.png"
}

/** How much of the last window shows again at the top of the next. */
private val OVERLAP = 48.dp

/** A guard against a screen that never reaches its end. */
private const val MAX_PARTS = 12

/**
 * Captures every window, a sheet or a dialog over the screen, and goes on
 * down the one part that [scroller] matches, such as the form in its
 * sheet, one window at a time, to its end. The images are named as those
 * of [captureWholeScreen].
 */
@OptIn(ExperimentalRoborazziApi::class)
fun ComposeTestRule.captureWholeWindows(name: String, config: ScreenshotConfig, scroller: SemanticsMatcher) {
    var part = 1
    waitForIdle()
    captureScreenRoboImage(path(name, config, part))
    val node = onNode(scroller)
    while (true) {
        val fetched = node.fetchSemanticsNode()
        val range = fetched.config[SemanticsProperties.VerticalScrollAxisRange]
        if (range.value() >= range.maxValue()) return
        val step = fetched.size.height - with(density) { OVERLAP.toPx() }
        node.performSemanticsAction(SemanticsActions.ScrollBy) { scrollBy -> scrollBy(0f, step) }
        waitForIdle()
        part++
        check(part <= MAX_PARTS) { "$name is more than $MAX_PARTS windows long in ${config.name}" }
        captureScreenRoboImage(path(name, config, part))
    }
}
