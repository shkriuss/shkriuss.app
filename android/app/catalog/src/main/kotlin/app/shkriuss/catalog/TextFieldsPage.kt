package app.shkriuss.catalog

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkTextField

/**
 * The text field in every state: empty, with text, with help, in error,
 * disabled, with several lines, and with a label and help long enough to
 * wrap. Only the field under "Try it" takes typing; the others keep the
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
            ),
        )
    }
}

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
 * shows an error, so the owner can see the error state come and go.
 */
@Composable
private fun TextFieldToTry() {
    var value by rememberSaveable { mutableStateOf("") }
    ShkTextField(
        value = value,
        onValueChange = { value = it },
        label = stringResource(R.string.sample_name),
        supportingText = stringResource(R.string.sample_name_limit),
        errorText = if (value.length > NAME_LIMIT) stringResource(R.string.sample_name_too_long) else null,
    )
}

/** The length past which the field to try shows its error. */
private const val NAME_LIMIT = 20
