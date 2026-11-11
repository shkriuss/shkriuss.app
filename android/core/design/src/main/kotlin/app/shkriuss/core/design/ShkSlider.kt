package app.shkriuss.core.design

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription

/**
 * A slider, for picking a value in a range where the exact number matters
 * less than where it sits, such as a daily goal or a volume. For a value
 * the user must get exactly right, use a [ShkTextField].
 *
 * [label] names the value and [valueText] says what it is now in words,
 * such as "8 glasses". Both show above the slider, and TalkBack reads them
 * instead of a percentage, so the caller formats [valueText] with the
 * unit, from a plural string resource. Keep it short.
 *
 * With [steps], the value snaps to that many points between the ends of
 * [valueRange], and the track shows a mark at each. Moving it calls
 * [onValueChange]; the caller changes [value]. [onValueChangeFinished] is
 * called when the user lets go.
 *
 * It fills the width it is given. The slider is 48dp tall. The label
 * wraps at large font sizes.
 */
@Composable
fun ShkSlider(
    label: String,
    value: Float,
    onValueChange: (Float) -> Unit,
    valueText: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    valueRange: ClosedFloatingPointRange<Float> = 0f..1f,
    steps: Int = 0,
    onValueChangeFinished: (() -> Unit)? = null,
) {
    val colors = ShkTheme.colors
    val alpha = if (enabled) 1f else DisabledContentAlpha
    Column(modifier.fillMaxWidth()) {
        // The slider tells TalkBack the label and the value itself, so the
        // text above it is hidden from TalkBack and not read a second time.
        val hidden = Modifier.semantics { hideFromAccessibility() }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(ShkSpacing.Small)) {
            ShkText(
                text = label,
                modifier = hidden.weight(1f),
                color = colors.text.copy(alpha = alpha),
            )
            ShkText(text = valueText, modifier = hidden, color = colors.textSecondary.copy(alpha = alpha))
        }
        Slider(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.semantics {
                contentDescription = label
                stateDescription = valueText
            },
            enabled = enabled,
            valueRange = valueRange,
            steps = steps,
            onValueChangeFinished = onValueChangeFinished,
            colors = SliderDefaults.colors(
                thumbColor = colors.accent,
                activeTrackColor = colors.accent,
                activeTickColor = colors.textOnAccent,
                // Material 3 uses the higher surface colour, 1.2:1 on the
                // background. The outline keeps the track visible, at least
                // 3:1, and the marks on it are the background colour.
                inactiveTrackColor = colors.outline,
                inactiveTickColor = colors.background,
            ),
        )
    }
}
