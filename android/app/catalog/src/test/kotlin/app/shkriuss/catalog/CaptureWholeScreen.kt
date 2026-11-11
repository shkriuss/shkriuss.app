package app.shkriuss.catalog

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage

/**
 * Captures the whole of a scrolling screen, one window at a time, so a
 * long page is checked to its end, at font scale 2.0 too.
 *
 * The first image is `<name>_<config>.png`. If the screen scrolls, it
 * scrolls down by one window less an overlap and captures
 * `<name>_<config>_part2.png`, and so on to the end. The overlap shows
 * the lines cut at the edge of one image whole in the next.
 *
 * It scrolls the screen itself: the outermost part that scrolls. Samples
 * on a page, such as a navigation rail or the panes of a list and detail,
 * can scroll inside it.
 */
fun ComposeTestRule.captureWholeScreen(name: String, config: ScreenshotConfig) {
    val scroller = onNode(hasScrollAction() and !hasAnyAncestor(hasScrollAction()))
    var part = 1
    onRoot().captureRoboImage(path(name, config, part))
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
