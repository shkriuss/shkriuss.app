package app.shkriuss.catalog

import android.view.WindowManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import app.shkriuss.core.design.ShkSpacing
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Starts the app the way the launcher does and checks what the Catalog
 * shows, how it moves between pages, and what TalkBack hears.
 */
@RunWith(RobolectricTestRunner::class)
class CatalogScreenTest {
    @get:Rule
    val compose = createAndroidComposeRule<CatalogActivity>()

    @Test
    fun showsTheTitleAsAHeading() {
        compose.onNodeWithText("Catalog")
            .assertIsDisplayed()
            .assert(isHeading())
    }

    @Test
    fun hasAButtonForEveryPage() {
        CatalogPage.entries.forEach { page ->
            compose.onNode(hasText(text(page.title)))
                .performScrollTo()
                .assertIsDisplayed()
                .assertHasClickAction()
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
                .assertHeightIsAtLeast(ShkSpacing.MinTouchTarget)
        }
    }

    @Test
    fun everyPageOpensWithItsTitleAsAHeadingAndBackReturns() {
        CatalogPage.entries.forEach { page ->
            compose.onNode(hasText(text(page.title))).performScrollTo().performClick()
            compose.onNode(hasText(text(page.title)) and isHeading()).assertIsDisplayed()

            compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
            compose.onNodeWithText("Catalog").assertIsDisplayed().assert(isHeading())
        }
    }

    @Test
    fun colourPageTellsTalkBackTheContrast() {
        compose.onNode(hasText(text(R.string.page_colors_title))).performScrollTo().performClick()
        // The light theme's text on the background, 18.34:1 (ADR 0017).
        compose.onNode(
            SemanticsMatcher.expectValue(SemanticsProperties.ContentDescription, listOf("Text, contrast 18.34 to 1")),
        ).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun theProtectionSwitchProtectsThePageAsAnAppProtectsTheScreens() {
        listOf(CatalogPage.RecoveryKeyScreens, CatalogPage.AppLockScreens).forEach { page ->
            compose.onNode(hasText(text(page.title))).performScrollTo().performClick()
            val decor = compose.activity.window.decorView
            assertFalse("${page.name}: off at first, so screenshots can be sent", isSecure())
            assertFalse(decor.filterTouchesWhenObscured)

            compose.onNode(hasText(text(R.string.recovery_key_block))).performScrollTo().performClick()
            compose.waitForIdle()
            assertTrue("${page.name}: screenshots blocked", isSecure())
            assertTrue("${page.name}: a tap under another app's window does nothing", decor.filterTouchesWhenObscured)
            assertTrue("${page.name}: only accessibility tools can read it", decor.isAccessibilityDataSensitive)

            compose.onNode(hasText(text(R.string.recovery_key_block))).performClick()
            compose.waitForIdle()
            assertFalse(isSecure())
            assertFalse(decor.filterTouchesWhenObscured)
            assertFalse(decor.isAccessibilityDataSensitive)

            compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        }
    }

    private fun isSecure() = compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0

    private fun text(id: Int): String = compose.activity.getString(id)
}
