package app.shkriuss.core.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * The suite's theme. Every screen of every app is drawn inside it.
 *
 * It follows the system setting for dark theme. Colours are fixed, never
 * dynamic, and the dark theme is true black (ADR 0017).
 *
 * It also sets up Material 3, which only `core/design` uses, so that every
 * Material 3 colour, text style and shape comes from the suite's tokens.
 * The mapping is in `docs/development/design-system.md`.
 */
@Composable
fun ShkTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) DarkShkColors else LightShkColors
    CompositionLocalProvider(LocalShkColors provides colors) {
        MaterialTheme(
            colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme,
            typography = MaterialTypography,
            shapes = MaterialShapes,
            content = content,
        )
    }
}

/**
 * The tokens of the current theme. Read them inside [ShkTheme].
 *
 * Text styles, shapes and spacing are the same in both themes. They are in
 * [ShkTextStyle], [ShkShapes] and [ShkSpacing].
 */
object ShkTheme {
    /** The colours of the current theme, light or dark. */
    val colors: ShkColors
        @Composable
        @ReadOnlyComposable
        get() = LocalShkColors.current
}

private val LocalShkColors = staticCompositionLocalOf<ShkColors> {
    error("No ShkTheme. Draw every screen inside ShkTheme.")
}

/** Material 3's colours for the light theme. Every one is a light token. */
internal val LightColorScheme: ColorScheme = materialColorScheme(
    colors = LightShkColors,
    inverse = DarkShkColors,
    dark = false,
)

/** Material 3's colours for the dark theme. Every one is a dark token. */
internal val DarkColorScheme: ColorScheme = materialColorScheme(
    colors = DarkShkColors,
    inverse = LightShkColors,
    dark = true,
)

/**
 * Gives every Material 3 colour role one of the suite's colours, so no
 * colour of Material's own baseline palette can show up. The constructor
 * has no defaults, so a new role in a Material 3 update fails the build
 * until it is mapped here.
 *
 * - Filled accent roles (primary, primary container, secondary, tertiary
 *   and the fixed roles) are the accent, with text on accent on them.
 * - Tonal containers are the higher surface, with normal text on them.
 * - Raised surfaces get no tint: [ColorScheme.surfaceTint] is the
 *   background, so tonal elevation changes nothing (ADR 0017, point 5).
 * - Inverse roles, for snackbars, use the text colour as their surface and
 *   the other theme's accent.
 */
private fun materialColorScheme(colors: ShkColors, inverse: ShkColors, dark: Boolean): ColorScheme =
    ColorScheme(
        primary = colors.accent,
        onPrimary = colors.textOnAccent,
        primaryContainer = colors.accent,
        onPrimaryContainer = colors.textOnAccent,
        inversePrimary = inverse.accent,
        secondary = colors.accent,
        onSecondary = colors.textOnAccent,
        secondaryContainer = colors.surfaceHigh,
        onSecondaryContainer = colors.text,
        tertiary = colors.accent,
        onTertiary = colors.textOnAccent,
        tertiaryContainer = colors.surfaceHigh,
        onTertiaryContainer = colors.text,
        background = colors.background,
        onBackground = colors.text,
        surface = colors.background,
        onSurface = colors.text,
        surfaceVariant = colors.surfaceHigh,
        onSurfaceVariant = colors.textSecondary,
        surfaceTint = colors.background,
        inverseSurface = colors.text,
        inverseOnSurface = colors.background,
        error = colors.error,
        onError = colors.background,
        errorContainer = colors.surfaceHigh,
        onErrorContainer = colors.error,
        outline = colors.outline,
        outlineVariant = colors.outline,
        scrim = Color.Black,
        surfaceBright = if (dark) colors.surfaceHigh else colors.background,
        surfaceContainer = colors.surface,
        surfaceContainerHigh = colors.surfaceHigh,
        surfaceContainerHighest = colors.surfaceHigh,
        surfaceContainerLow = colors.surface,
        surfaceContainerLowest = colors.background,
        surfaceDim = if (dark) colors.background else colors.surfaceHigh,
        primaryFixed = colors.accent,
        primaryFixedDim = colors.accent,
        onPrimaryFixed = colors.textOnAccent,
        onPrimaryFixedVariant = colors.textOnAccent,
        secondaryFixed = colors.accent,
        secondaryFixedDim = colors.accent,
        onSecondaryFixed = colors.textOnAccent,
        onSecondaryFixedVariant = colors.textOnAccent,
        tertiaryFixed = colors.accent,
        tertiaryFixedDim = colors.accent,
        onTertiaryFixed = colors.textOnAccent,
        onTertiaryFixedVariant = colors.textOnAccent,
    )

/**
 * The opacity of the text and icons of a component that is turned off.
 * It is Material 3's, so text the suite draws next to a disabled Material 3
 * control dims the same way. WCAG asks for no contrast on a disabled
 * control.
 */
internal const val DisabledContentAlpha = 0.38f

/**
 * Material 3's fifteen text styles, each set to one of the suite's six.
 * Material 3 components then use only the suite's styles.
 */
internal val MaterialTypography = Typography(
    displayLarge = ShkTextStyle.Headline.textStyle,
    displayMedium = ShkTextStyle.Headline.textStyle,
    displaySmall = ShkTextStyle.Headline.textStyle,
    headlineLarge = ShkTextStyle.Headline.textStyle,
    headlineMedium = ShkTextStyle.Headline.textStyle,
    headlineSmall = ShkTextStyle.Headline.textStyle,
    titleLarge = ShkTextStyle.Title.textStyle,
    titleMedium = ShkTextStyle.Subtitle.textStyle,
    titleSmall = ShkTextStyle.Label.textStyle,
    bodyLarge = ShkTextStyle.Body.textStyle,
    bodyMedium = ShkTextStyle.Body.textStyle,
    bodySmall = ShkTextStyle.Caption.textStyle,
    labelLarge = ShkTextStyle.Label.textStyle,
    labelMedium = ShkTextStyle.Caption.textStyle,
    labelSmall = ShkTextStyle.Caption.textStyle,
)

/**
 * Material 3's five corner sizes, each set to one of the suite's rounded
 * shapes. Buttons in Material 3 are already pills. Components pick their
 * shape from [ShkShapes] themselves; this is the fallback.
 */
internal val MaterialShapes = Shapes(
    extraSmall = ShkShapes.Field,
    small = ShkShapes.Field,
    medium = ShkShapes.Card,
    large = ShkShapes.Card,
    extraLarge = ShkShapes.Sheet,
)
