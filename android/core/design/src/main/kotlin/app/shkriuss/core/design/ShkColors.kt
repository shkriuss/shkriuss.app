package app.shkriuss.core.design

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * The colour tokens of one theme. Screens read them through
 * [ShkTheme.colors], so the same code draws the light and the dark theme.
 *
 * The values are fixed (ADR 0017). There is no dynamic colour, so the
 * contrast of every pair is checked once, in a unit test, and screenshots
 * look the same on every device. How to use each token is in
 * `docs/development/design-system.md`.
 */
@Immutable
class ShkColors internal constructor(
    /** Behind everything on a screen. True black in the dark theme. */
    val background: Color,
    /** Cards and grouped content on the background. */
    val surface: Color,
    /** Content that sits on a surface or must stand out more: sheets, dialogs, menus. */
    val surfaceHigh: Color,
    /** Normal text and icons. */
    val text: Color,
    /** Less important text: hints, captions, secondary lines. */
    val textSecondary: Color,
    /** Borders of raised surfaces, fields and other controls. Never for text. */
    val outline: Color,
    /**
     * Lines that only separate content, such as a divider between list
     * items. Lighter than [outline], because it is decorative. Never for
     * text or the border of a control.
     */
    val divider: Color,
    /** The teal accent: main actions, selection, links and focus. */
    val accent: Color,
    /** Text and icons on a filled accent area. */
    val textOnAccent: Color,
    /** Errors and destructive actions. */
    val error: Color,
    /** Something worked or is in a good state. */
    val success: Color,
    /** Something needs attention but is not an error. */
    val warning: Color,
)

/** The light theme. Values from ADR 0017. */
internal val LightShkColors = ShkColors(
    background = Color(0xFFFFFFFF),
    surface = Color(0xFFF3F4F2),
    surfaceHigh = Color(0xFFE7E9E6),
    text = Color(0xFF131514),
    textSecondary = Color(0xFF4A4F4C),
    outline = Color(0xFF7A807C),
    divider = Color(0xFFB8BCB9),
    accent = Color(0xFF00695C),
    textOnAccent = Color(0xFFFFFFFF),
    error = Color(0xFFB3261E),
    success = Color(0xFF1B6E3C),
    warning = Color(0xFF7A5800),
)

/** The true-black dark theme. Values from ADR 0017. */
internal val DarkShkColors = ShkColors(
    background = Color(0xFF000000),
    surface = Color(0xFF0D0E0E),
    surfaceHigh = Color(0xFF191B1A),
    text = Color(0xFFECEEEC),
    textSecondary = Color(0xFFA9AEAA),
    outline = Color(0xFF6F7571),
    divider = Color(0xFF3B3F3D),
    accent = Color(0xFF5FD6C2),
    textOnAccent = Color(0xFF00201B),
    error = Color(0xFFFFB4AB),
    success = Color(0xFF7FDB9A),
    warning = Color(0xFFF2C24B),
)
