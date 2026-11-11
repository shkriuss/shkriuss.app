package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Checks that [ShkWindowWidth] splits widths where Android's window size
 * classes do, and follows the window the app is drawn in: the phone and
 * the tablet of the screenshot tests, and the tablet held upright.
 */
@RunWith(RobolectricTestRunner::class)
class ShkWindowWidthTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale = 1f)).around(compose)

    @Test
    fun widthsSplitAt600And840Dp() {
        assertEquals(ShkWindowWidth.Compact, ShkWindowWidth.of(0.dp))
        assertEquals(ShkWindowWidth.Compact, ShkWindowWidth.of(599.dp))
        assertEquals(ShkWindowWidth.Medium, ShkWindowWidth.of(600.dp))
        assertEquals(ShkWindowWidth.Medium, ShkWindowWidth.of(839.dp))
        assertEquals(ShkWindowWidth.Expanded, ShkWindowWidth.of(840.dp))
        assertEquals(ShkSpacing.WideWindowWidth, ShkWindowWidth.MediumMinWidth)
    }

    @Test
    @Config(qualifiers = "w411dp-h914dp")
    fun aPhoneHeldUprightIsCompact() {
        assertEquals(ShkWindowWidth.Compact, currentWidth())
    }

    @Test
    @Config(qualifiers = "w800dp-h1280dp")
    fun aTabletHeldUprightIsMedium() {
        assertEquals(ShkWindowWidth.Medium, currentWidth())
    }

    @Test
    @Config(qualifiers = "w1280dp-h800dp")
    fun aTabletHeldSidewaysIsExpanded() {
        assertEquals(ShkWindowWidth.Expanded, currentWidth())
    }

    private fun currentWidth(): ShkWindowWidth {
        var width: ShkWindowWidth? = null
        compose.setContent { width = ShkWindowWidth.current }
        return compose.runOnIdle { checkNotNull(width) }
    }
}
