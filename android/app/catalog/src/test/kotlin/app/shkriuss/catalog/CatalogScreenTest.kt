package app.shkriuss.catalog

import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Starts the app the way the launcher does and checks what the Catalog
 * screen shows and what TalkBack hears.
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
}
