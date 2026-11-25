package app.shkriuss.catalog

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkTextEditor
import app.shkriuss.core.design.ShkTextField
import app.shkriuss.core.design.ShkTextLook
import app.shkriuss.core.design.ShkTextRange

/**
 * The text field in every state: empty, with text, with help, in error,
 * disabled, with several lines, and with a label and help long enough to
 * wrap. Then the text editor: empty, with styled ranges, in error, and to
 * try. Only the field under "Try it" takes typing; the others keep the
 * text their caption names. The focused state shows when the owner taps a
 * field.
 */
@Composable
fun TextFieldsPage(modifier: Modifier = Modifier) {
    ShkScreen(modifier = modifier, scrollable = true) {
        PageTitle(stringResource(R.string.page_text_fields_title))
        PageIntro(stringResource(R.string.text_fields_intro))

        ComponentHeading(stringResource(R.string.text_field_title), stringResource(R.string.text_field_use))
        val name = stringResource(R.string.sample_name_value)
        ComponentStates(
            listOf(
                ComponentState(R.string.state_field_empty) { FixedField(value = "") },
                ComponentState(R.string.state_with_text) { FixedField(value = name) },
                ComponentState(R.string.state_with_help) { FixedField(value = name, help = R.string.sample_name_help) },
                ComponentState(R.string.state_error) {
                    FixedField(value = "", help = R.string.sample_name_help, error = R.string.sample_name_error)
                },
                ComponentState(R.string.state_disabled) { FixedField(value = name, enabled = false) },
                ComponentState(R.string.state_several_lines) {
                    FixedField(
                        label = R.string.sample_note,
                        value = stringResource(R.string.sample_note_value),
                        singleLine = false,
                    )
                },
                ComponentState(R.string.state_long_label_help) {
                    FixedField(
                        label = R.string.sample_long_field_label,
                        value = "",
                        help = R.string.sample_long_field_help,
                    )
                },
                ComponentState(R.string.state_try_text_field) { TextFieldToTry() },
                ComponentState(R.string.state_with_suffix) {
                    ShkTextField(
                        value = stringResource(R.string.sample_amount_value),
                        onValueChange = {},
                        label = stringResource(R.string.sample_amount),
                        suffix = stringResource(R.string.sample_unit_ml),
                        suffixDescription = stringResource(R.string.sample_unit_ml_spoken),
                    )
                },
            ),
        )

        ComponentHeading(stringResource(R.string.text_editor_title), stringResource(R.string.text_editor_use))
        val note = stringResource(R.string.sample_editor_text)
        ComponentStates(
            listOf(
                ComponentState(R.string.state_editor_empty) { FixedEditor(text = "") },
                // The marks in the secondary colour, a heading, bold, and a done item dimmed and struck through.
                ComponentState(R.string.state_editor_styled) { FixedEditor(text = note, looks = sampleLooks(note)) },
                ComponentState(R.string.state_error) {
                    FixedEditor(text = note, looks = sampleLooks(note), error = stringResource(R.string.sample_editor_error))
                },
                ComponentState(R.string.state_try_text_editor) { TextEditorToTry() },
            ),
        )
    }
}

/** A text editor that keeps the text it is drawn with, so its caption stays true. */
@Composable
private fun FixedEditor(text: String, looks: List<ShkTextRange> = emptyList(), error: String? = null) {
    ShkTextEditor(
        text = text,
        selectionStart = 0,
        selectionEnd = 0,
        onChange = { _, _, _ -> },
        hint = stringResource(R.string.sample_editor_hint),
        looks = looks,
        errorText = error,
    )
}

/**
 * A text editor that takes typing, with its marks styled as typed. A tap on
 * the box of an item, `[ ]` or `[x]`, ticks it or opens it again, without
 * moving the cursor. What is typed stays in memory only.
 */
@Composable
private fun TextEditorToTry() {
    val start = stringResource(R.string.sample_editor_text)
    var text by remember { mutableStateOf(start) }
    var selection by remember { mutableStateOf(0 to 0) }
    ShkTextEditor(
        text = text,
        selectionStart = selection.first,
        selectionEnd = selection.second,
        onChange = { changed, from, to ->
            text = changed
            selection = from to to
        },
        hint = stringResource(R.string.sample_editor_hint),
        looks = sampleLooks(text),
        tapRanges = sampleBoxes(text),
        onTapRange = { box -> text = text.replaceRange(box.first + 1, box.first + 2, if (text[box.first + 1] == ' ') "x" else " ") },
    )
}

/**
 * The looks of a sample note, found as a note's marks are, in a few
 * lines: `# ` makes a heading, `- [ ] ` and `- [x] ` an item, the text of
 * a done item is dimmed and struck through, and `**` around text makes it
 * bold. The marks are in the secondary colour.
 */
private fun sampleLooks(text: String): List<ShkTextRange> = buildList {
    var lineStart = 0
    text.split('\n').forEach { line ->
        val end = lineStart + line.length
        when {
            line.startsWith("# ") -> {
                add(ShkTextRange(ShkTextLook.Quiet, lineStart, lineStart + 2))
                add(ShkTextRange(ShkTextLook.Heading, lineStart, end))
            }
            line.startsWith("- [ ] ") -> add(ShkTextRange(ShkTextLook.Quiet, lineStart, lineStart + ITEM_MARK))
            line.startsWith("- [x] ") -> {
                add(ShkTextRange(ShkTextLook.Quiet, lineStart, end))
                add(ShkTextRange(ShkTextLook.StruckThrough, lineStart + ITEM_MARK, end))
            }
        }
        BOLD.findAll(line).forEach { match ->
            val from = lineStart + match.range.first
            val to = lineStart + match.range.last + 1
            add(ShkTextRange(ShkTextLook.Quiet, from, from + 2))
            add(ShkTextRange(ShkTextLook.Bold, from + 2, to - 2))
            add(ShkTextRange(ShkTextLook.Quiet, to - 2, to))
        }
        lineStart = end + 1
    }
}

/** The boxes `[ ]` and `[x]` of the items of a sample note. */
private fun sampleBoxes(text: String): List<IntRange> = buildList {
    var lineStart = 0
    text.split('\n').forEach { line ->
        if (line.startsWith("- [ ] ") || line.startsWith("- [x] ")) add(lineStart + 2..lineStart + 4)
        lineStart += line.length + 1
    }
}

/** The length of the mark of an item, `- [ ] `. */
private const val ITEM_MARK = 6

/** Bold text between `**` marks, on one line. */
private val BOLD = Regex("\\*\\*[^* ][^*]*\\*\\*")

/** A text field that keeps the text it is drawn with, so its caption stays true. */
@Composable
private fun FixedField(
    value: String,
    @StringRes label: Int = R.string.sample_name,
    @StringRes help: Int? = null,
    @StringRes error: Int? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
) {
    ShkTextField(
        value = value,
        onValueChange = {},
        label = stringResource(label),
        enabled = enabled,
        singleLine = singleLine,
        supportingText = help?.let { stringResource(it) },
        errorText = error?.let { stringResource(it) },
    )
}

/**
 * A text field that takes typing, as in an app. Past 20 characters it
 * shows an error, so the owner can see the error state come and go. What
 * is typed stays in memory only, never in Android's saved state: it goes
 * when the phone turns or Catalog closes.
 */
@Composable
private fun TextFieldToTry() {
    var value by remember { mutableStateOf("") }
    ShkTextField(
        value = value,
        onValueChange = { value = it },
        label = stringResource(R.string.sample_name),
        supportingText = stringResource(R.string.sample_name_limit),
        // Characters as the user sees them: an emoji is one, though it takes two UTF-16 units.
        errorText = if (value.codePointCount(0, value.length) > NAME_LIMIT) stringResource(R.string.sample_name_too_long) else null,
    )
}

/** The length past which the field to try shows its error. */
private const val NAME_LIMIT = 20
