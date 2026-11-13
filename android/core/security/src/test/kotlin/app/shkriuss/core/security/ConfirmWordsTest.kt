package app.shkriuss.core.security

import android.content.ComponentName
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import app.shkriuss.core.design.ShkTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

/** The four words that confirm a new recovery key, typed into the screen that asks for them. */
@RunWith(RobolectricTestRunner::class)
class ConfirmWordsTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    /** The plain activity is in no manifest, so it is added to Robolectric's package manager first, as in `core/design`. */
    private val plainActivity = object : ExternalResource() {
        override fun before() {
            val app = RuntimeEnvironment.getApplication()
            shadowOf(app.packageManager).addActivityIfNotPresent(ComponentName(app, ComponentActivity::class.java))
        }
    }

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(plainActivity).around(compose)

    private fun fieldFor(position: Int) = hasSetTextAction() and hasText("Word $position")

    private fun typedIn(position: Int): String =
        compose.onNode(fieldFor(position)).fetchSemanticsNode().config.getOrNull(SemanticsProperties.EditableText)?.text.orEmpty()

    @OptIn(SecurityScreenSamples::class)
    @Test
    fun lettersThatStartNoWordAreNamedUnderTheirFieldAtOnce() {
        compose.setContent {
            ShkTheme {
                var screen by remember { mutableStateOf(CreateConfirm(listOf(3, 9, 15, 22), List(4) { "" })) }
                CreateContent(
                    screen = screen,
                    previewBuild = false,
                    actions = CreateActions(
                        onAnswerChange = { index, text ->
                            screen = screen.copy(answers = screen.answers.toMutableList().also { it[index] = text })
                        },
                    ),
                )
            }
        }
        val message = compose.activity.getString(R.string.sec_word_starts_no_word)
        val noError = SemanticsMatcher.keyNotDefined(SemanticsProperties.Error)

        "ab".forEach { letter -> compose.onNode(fieldFor(9)).performTextInput(letter.toString()) }
        compose.onNode(fieldFor(9)).assert(noError)

        compose.onNode(fieldFor(9)).performTextInput("j")
        compose.onNode(fieldFor(9)).assert(SemanticsMatcher.expectValue(SemanticsProperties.Error, message))
        listOf(3, 15, 22).forEach { position -> compose.onNode(fieldFor(position)).assert(noError) }

        compose.onNode(fieldFor(9)).performImeAction()
        assertEquals("the next key takes nothing", "abj", typedIn(9))
    }
}
