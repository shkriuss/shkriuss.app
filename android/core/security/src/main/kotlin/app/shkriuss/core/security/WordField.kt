package app.shkriuss.core.security

import android.text.InputType
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.contextmenu.modifier.filterTextContextMenuComponents
import androidx.compose.foundation.text.contextmenu.provider.LocalTextContextMenuDropdownProvider
import androidx.compose.foundation.text.contextmenu.provider.TextContextMenuDataProvider
import androidx.compose.foundation.text.contextmenu.provider.TextContextMenuProvider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.InterceptPlatformTextInput
import androidx.compose.ui.platform.LocalTextToolbar
import androidx.compose.ui.platform.PlatformTextInputMethodRequest
import androidx.compose.ui.platform.TextToolbar
import androidx.compose.ui.platform.TextToolbarStatus
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.copyText
import androidx.compose.ui.semantics.cutText
import androidx.compose.ui.semantics.pasteText
import androidx.compose.ui.semantics.semantics
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

    /**
     * True when [typed] holds letters that start no word of the list, such
     * as "abj". Then no suggestion shows and the keyboard's action key does
     * nothing, so the field says why ([WordField]).
     */
    fun startsNoWord(typed: String): Boolean = typed.isNotEmpty() && RecoveryWords.list.none { it.startsWith(typed) }

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
 * When the letters start no word of the list, the field says so under it
 * at once, as its error ([WordInput.startsNoWord]). That message comes
 * before [errorText].
 *
 * The keyboard is asked for a password field that shows its letters, with
 * no suggestions and no learning ([NoLearningKeyboard]): it offers no
 * spell check and keeps nothing of what is typed.
 *
 * Nothing is copied or cut from the field, and nothing is pasted into it
 * ([noCopyCutPaste]): not from a menu, not by a keyboard shortcut such as
 * Ctrl+C, and not by an accessibility action. Its text menu offers
 * nothing, so no menu shows. [WordInput.accept] also refuses a change of
 * more than one letter.
 *
 * Autofill and content capture are off for the whole window
 * ([secureWindow]). The suggestions are drawn in the screen itself, never
 * in a popup window of their own.
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
    val startsNoWord = if (WordInput.startsNoWord(value)) stringResource(R.string.sec_word_starts_no_word) else null
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small)) {
        CompositionLocalProvider(
            LocalTextContextMenuDropdownProvider provides NoTextMenu,
            LocalTextToolbar provides NoTextToolbar,
        ) {
            NoLearningKeyboard {
                ShkTextField(
                    value = value,
                    onValueChange = { new -> WordInput.accept(value, new)?.let(onValueChange) },
                    label = label,
                    modifier = Modifier.noCopyCutPaste(),
                    errorText = startsNoWord ?: errorText,
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

/**
 * Closes every way in which a text field of Compose copies, cuts or
 * pastes. They are read in the sources of Compose Foundation 1.12.1; a
 * newer version is checked against this list again.
 *
 * 1. The menu over selected text. Every entry is taken out: copy, cut and
 *    paste, and also the entries that hand the selected text to another
 *    app, such as "Share". Android shows no menu that has no entry.
 * 2. Keys. A keyboard shortcut for copy, cut or paste is taken before the
 *    field sees it ([isClipboardKey]). A keyboard app sends its own copy,
 *    cut and paste as such keys too.
 * 3. Accessibility actions. The field's own copy, cut and paste are
 *    replaced by actions that do nothing. An accessibility tool may still
 *    list them.
 *
 * Smart selection, which hands selected text to Android's text
 * classifier, is turned off for the whole app by `AppLockWatcher.start()`
 * (`ComposeFoundationFlags.isSmartSelectionEnabled`). A newer Compose is
 * checked for that flag too.
 */
private fun Modifier.noCopyCutPaste(): Modifier = this
    .filterTextContextMenuComponents { false }
    .onPreviewKeyEvent { event -> event.isClipboardKey() }
    .semantics {
        copyText { false }
        cutText { false }
        pasteText { false }
    }

/**
 * True for a key that a text field of Compose takes as copy, cut or paste
 * (its `KeyMapping`): Ctrl with C, X, V or Insert, Shift with Insert, and
 * the keys Copy, Cut and Paste. It is also true for the same letters with
 * the Meta key and with more keys held, which a text field ignores.
 */
private fun KeyEvent.isClipboardKey(): Boolean = when (key) {
    Key.Copy, Key.Cut, Key.Paste -> true
    Key.C, Key.X, Key.V -> isCtrlPressed || isMetaPressed
    Key.Insert, Key.NumPadInsert -> isCtrlPressed || isMetaPressed || isShiftPressed
    else -> false
}

/**
 * The menu that a click of the right mouse button opens on a text field.
 * With no entry it would open empty, so it never opens.
 */
private object NoTextMenu : TextContextMenuProvider {
    override suspend fun showTextContextMenu(dataProvider: TextContextMenuDataProvider) = Unit
}

/**
 * The text menu of Compose before its new context menu
 * (`ComposeFoundationFlags.isNewContextMenuEnabled`). It never shows
 * either: no copy, no cut and no paste.
 */
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
