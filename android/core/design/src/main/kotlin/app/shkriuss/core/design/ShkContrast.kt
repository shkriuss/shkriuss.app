package app.shkriuss.core.design

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.colorspace.ColorSpaces
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * The contrast ratio of two opaque colours, as WCAG 2.2 defines it: from
 * 1.0 (the same colour) to 21.0 (black and white). The order of the two
 * colours does not matter.
 *
 * It exists so the contrast test and the Catalog's colour page use one
 * formula. Text needs at least 4.5, outlines at least 3.0 (ADR 0017).
 */
fun contrastRatio(foreground: Color, background: Color): Double {
    val first = relativeLuminance(foreground)
    val second = relativeLuminance(background)
    return (max(first, second) + 0.05) / (min(first, second) + 0.05)
}

/** The relative luminance of a colour in sRGB, from 0.0 (black) to 1.0 (white). */
internal fun relativeLuminance(color: Color): Double {
    val srgb = color.convert(ColorSpaces.Srgb)
    return 0.2126 * linear(srgb.red) + 0.7152 * linear(srgb.green) + 0.0722 * linear(srgb.blue)
}

/** One sRGB channel, from 0.0 to 1.0, without its gamma curve. */
private fun linear(channel: Float): Double {
    val value = channel.toDouble()
    return if (value <= 0.04045) value / 12.92 else ((value + 0.055) / 1.055).pow(2.4)
}
