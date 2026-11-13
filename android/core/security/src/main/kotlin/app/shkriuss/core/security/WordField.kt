package app.shkriuss.core.security

import android.text.InputType
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.InterceptPlatformTextInput
import androidx.compose.ui.platform.LocalTextToolbar
import androidx.compose.ui.platform.PlatformTextInputMethodRequest
import androidx.compose.ui.platform.TextToolbar
import androidx.compose.ui.platform.TextToolbarStatus
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import app.shkriuss.core.crypto.RecoveryWords
import app.shkriuss.core.design.ShkAssistChip
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkTextField
import java.util.Locale

/**
 * What a field for one recovery word accepts ("Entering it" in
 * crypto-design.md). The words are typed, never pasted.
 */
internal object WordInput {
    /** The longest word of the list has eight letters. */
    const val LONGEST = 8

    /** Suggestions start at this many letters. */
    private const val SUGGEST_FROM = 2

    /** At most this many suggestions show. */
    private const val MOST_SUGGESTIONS = 4

    /** The first four letters of a word are enough to know it. */
    private const val ENOUGH_LETTERS = 4

    private val known: Set<String> by lazy { RecoveryWords.list.toSet() }

    /**
     * The text after a change from [old] to [new], or null if the change
     * is refused. Only the letters `a` to `z`, made lower case the same
     * way in every language, and at most [LONGEST] of them. A change may
     * add one letter at most, so a pasted word or phrase never lands.
     */
    fun accept(old: String, new: String): String? {
        val lower = new.lowercase(Locale.ROOT)
        if (lower.length > LONGEST || lower.length > old.length + 1) return null
        if (!lower.all { it in 'a'..'z' }) return null
        return lower
    }

    /** The words of the list that start with [typed], at most four, once two letters are typed. */
    fun suggestions(typed: String): List<String> =
        if (typed.length < SUGGEST_FROM) emptyList() else RecoveryWords.list.filter { it.startsWith(typed) }.take(MOST_SUGGESTIONS)

    /** The word [typed] stands for: itself if it is a word, or the one word it starts once four letters are typed. */
    fun completion(typed: String): String? = when {
        typed in known -> typed
        typed.length >= ENOUGH_LETTERS -> RecoveryWords.list.filter { it.startsWith(typed) }.singleOrNull()
        else -> null
    }
}

/**
 * A field for one recovery word, with the words of the list that start
 * with what is typed shown under it as buttons. Picking one, or pressing
 * the keyboard's action key on a word that is known, calls [onWord].
 *
 * The keyboard is asked for a password field that shows its letters, with
 * no suggestions and no learning ([NoLearningKeyboard]): it offers no
 * spell check and keeps nothing of what is typed. The field
 * offers no paste: its text menu shows nothing, and [WordInput.accept]
 * refuses a change of more than one letter. Autofill and content capture
 * are off for the whole window ([secureWindow]). The suggestions are drawn
 * in the screen itself, never in a popup window of their own.
 */
@Composable
internal fun WordField(
    value: String,
    onValueChange: (String) -> Unit,
    onWord: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    errorText: String? = null,
    imeAction: ImeAction = ImeAction.Next,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small)) {
        CompositionLocalProvider(LocalTextToolbar provides NoTextToolbar) {
            NoLearningKeyboard {
                ShkTextField(
                    value = value,
                    onValueChange = { new -> WordInput.accept(value, new)?.let(onValueChange) },
                    label = label,
                    errorText = errorText,
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.None,
                        autoCorrectEnabled = false,
                        keyboardType = KeyboardType.Password,
                        imeAction = imeAction,
                    ),
                    keyboardActions = KeyboardActions(
                        onNext = { WordInput.completion(value)?.let(onWord) },
                        onDone = { WordInput.completion(value)?.let(onWord) },
                    ),
                )
            }
        }
        val suggestions = WordInput.suggestions(value)
        if (suggestions.isNotEmpty()) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Small),
                verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small),
            ) {
                suggestions.forEach { word -> ShkAssistChip(text = word, onClick = { onWord(word) }) }
            }
        }
    }
}

/**
 * Tells the keyboard of the field in [content] not to learn what is typed
 * and to offer no suggestions: the flags `IME_FLAG_NO_PERSONALIZED_LEARNING`
 * and `TYPE_TEXT_FLAG_NO_SUGGESTIONS`, on top of the password field that
 * Compose asks for. Compose has no option for them, so they are added to
 * what Compose tells the keyboard.
 */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
private fun NoLearningKeyboard(content: @Composable () -> Unit) {
    InterceptPlatformTextInput(
        interceptor = { request, nextHandler ->
            val withoutLearning = object : PlatformTextInputMethodRequest {
                override fun createInputConnection(outAttributes: EditorInfo): InputConnection {
                    val connection = request.createInputConnection(outAttributes)
                    outAttributes.imeOptions = outAttributes.imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
                    outAttributes.inputType = outAttributes.inputType or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
                    return connection
                }
            }
            nextHandler.startInputMethod(withoutLearning)
        },
        content = content,
    )
}

/** A text menu that never shows: no copy, no cut and no paste. */
private object NoTextToolbar : TextToolbar {
    override val status: TextToolbarStatus = TextToolbarStatus.Hidden

    override fun hide() = Unit

    override fun showMenu(
        rect: Rect,
        onCopyRequested: (() -> Unit)?,
        onPasteRequested: (() -> Unit)?,
        onCutRequested: (() -> Unit)?,
        onSelectAllRequested: (() -> Unit)?,
    ) = Unit
}
