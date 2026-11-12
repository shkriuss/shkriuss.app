package app.shkriuss.core.design

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.VisualTransformation

/**
 * A field to type text into, such as a name, an amount or a short note.
 * Use it whenever the user types. To choose from a few fixed options, use
 * radio buttons instead.
 *
 * [label] is required. It sits above the outlined box, always visible, and
 * TalkBack reads it with the field. It never moves into the border, so a
 * label that wraps at a large font size cannot cover the box or the text
 * above it. [supportingText] is an optional line of help under the box.
 *
 * Pass [errorText] to show that the value is wrong. The box, the label and
 * the line under it turn the error colour, and [errorText] replaces
 * [supportingText]. TalkBack announces it as the error, once.
 *
 * The field fills the width it is given. With [singleLine] it is one line
 * tall and scrolls sideways; otherwise it grows with the text. The label
 * and the line under it wrap. It is at least 48dp tall.
 */
@Composable
fun ShkTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    supportingText: String? = null,
    errorText: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    TextFieldInStyle(
        value = value,
        onValueChange = onValueChange,
        label = label,
        textStyle = ShkTextStyle.Body,
        modifier = modifier,
        enabled = enabled,
        singleLine = singleLine,
        supportingText = supportingText,
        errorText = errorText,
        keyboardOptions = keyboardOptions,
        keyboardActions = keyboardActions,
    )
}

/**
 * A [ShkTextField] whose typed text is in [textStyle] instead of the body
 * style, such as the large numbers of the hour and the minute in a
 * [ShkTimePicker]. Everything else is the same.
 */
@Composable
internal fun TextFieldInStyle(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    textStyle: ShkTextStyle,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    supportingText: String? = null,
    errorText: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val focused by interactionSource.collectIsFocusedAsState()
    val isError = errorText != null
    val colors = textFieldColors()
    val labelColor = when {
        !enabled -> colors.disabledLabelColor
        isError -> colors.errorLabelColor
        focused -> colors.focusedLabelColor
        else -> colors.unfocusedLabelColor
    }
    val textColor = if (enabled) colors.focusedTextColor else colors.disabledTextColor
    val lineUnder = errorText ?: supportingText

    CompositionLocalProvider(LocalTextSelectionColors provides colors.textSelectionColors) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = modifier
                .fillMaxWidth()
                // Merges the label and the line under the box into the field,
                // as Material 3 does for its own label, so TalkBack reads
                // them with the field and a tap on the label focuses it.
                .semantics(mergeDescendants = true) {
                    if (errorText != null) error(errorText)
                },
            enabled = enabled,
            textStyle = textStyle.textStyle.copy(color = textColor),
            keyboardOptions = keyboardOptions,
            keyboardActions = keyboardActions,
            singleLine = singleLine,
            interactionSource = interactionSource,
            cursorBrush = SolidColor(if (isError) colors.errorCursorColor else colors.cursorColor),
            decorationBox = { innerTextField ->
                Column {
                    // Inset as Material 3 insets its own label above a field.
                    ShkText(
                        text = label,
                        style = ShkTextStyle.Caption,
                        color = labelColor,
                        modifier = Modifier.padding(
                            start = ShkSpacing.ExtraSmall,
                            end = ShkSpacing.ExtraSmall,
                            bottom = ShkSpacing.ExtraSmall,
                        ),
                    )
                    // Material 3's box keeps its own width unless it is
                    // given a minimum, so it would be narrower than a long
                    // label. This makes it as wide as the field.
                    Box(Modifier.fillMaxWidth(), propagateMinConstraints = true) {
                        OutlinedTextFieldDefaults.DecorationBox(
                            value = value,
                            innerTextField = innerTextField,
                            enabled = enabled,
                            singleLine = singleLine,
                            visualTransformation = VisualTransformation.None,
                            interactionSource = interactionSource,
                            isError = isError,
                            supportingText = lineUnder?.let { text ->
                                { LineUnderField(text, isError) }
                            },
                            colors = colors,
                            container = {
                                OutlinedTextFieldDefaults.Container(
                                    enabled = enabled,
                                    isError = isError,
                                    interactionSource = interactionSource,
                                    colors = colors,
                                    shape = ShkShapes.Field,
                                )
                            },
                        )
                    }
                }
            },
        )
    }
}

/**
 * The help or error line under the box, in the caption style and the
 * colour Material 3 gives it. An error is hidden from TalkBack as text,
 * because the field already announces it as its error.
 */
@Composable
private fun LineUnderField(text: String, isError: Boolean) {
    ShkText(
        text = text,
        style = ShkTextStyle.Caption,
        modifier = if (isError) Modifier.clearAndSetSemantics {} else Modifier,
    )
}

/**
 * The colours of a text field. The text is `text`, the box `outline`, the
 * label and the line under the box `textSecondary`. A focused field draws
 * its box and label in the accent, a field in error in the error colour.
 * The disabled colours are Material 3's.
 */
@Composable
private fun textFieldColors(): TextFieldColors {
    val colors = ShkTheme.colors
    return OutlinedTextFieldDefaults.colors(
        focusedTextColor = colors.text,
        unfocusedTextColor = colors.text,
        errorTextColor = colors.text,
        cursorColor = colors.accent,
        errorCursorColor = colors.error,
        focusedBorderColor = colors.accent,
        unfocusedBorderColor = colors.outline,
        errorBorderColor = colors.error,
        focusedLabelColor = colors.accent,
        unfocusedLabelColor = colors.textSecondary,
        errorLabelColor = colors.error,
        focusedSupportingTextColor = colors.textSecondary,
        unfocusedSupportingTextColor = colors.textSecondary,
        errorSupportingTextColor = colors.error,
    )
}
