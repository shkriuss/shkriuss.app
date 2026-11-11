package app.shkriuss.core.design

import androidx.activity.ComponentActivity
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.filter
import androidx.compose.ui.test.isSelectable
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onChildren
import androidx.compose.ui.test.onNodeWithTag
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Checks that [ShkRadioGroup] tells TalkBack its radio buttons belong to
 * one choice, so TalkBack can say, for example, "2 of 3".
 */
@RunWith(RobolectricTestRunner::class)
class ShkRadioGroupTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(TestActivitySetUp(fontScale = 1f)).around(compose)

    @Test
    fun marksItsRadioButtonsAsOneGroup() {
        compose.setContent {
            ShkTheme {
                ShkRadioGroup(Modifier.testTag(GROUP)) {
                    ShkRadioButton(text = "Millilitres", selected = true, onClick = {})
                    ShkRadioButton(text = "Ounces", selected = false, onClick = {})
                    ShkRadioButton(text = "Cups", selected = false, onClick = {})
                }
            }
        }

        compose.onNodeWithTag(GROUP)
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.SelectableGroup))
            .onChildren()
            .filter(isSelectable())
            .assertCountEquals(3)
    }

    private companion object {
        const val GROUP = "group"
    }
}
