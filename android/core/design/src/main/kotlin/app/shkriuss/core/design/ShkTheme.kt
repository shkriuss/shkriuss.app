package app.shkriuss.core.design

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/**
 * The suite's theme. Every screen of every app is drawn inside it.
 *
 * It follows the system setting for dark theme. Colours are fixed, never
 * dynamic. The dark theme is true black. The values come from ADR 0017.
 *
 * This is a stub from Phase 0. Phase 1, step 1 adds the full colour, type,
 * shape and spacing tokens.
 */
@Composable
fun ShkTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}

private val LightColors: ColorScheme = lightColorScheme(
    primary = Color(0xFF00695C),
    onPrimary = Color(0xFFFFFFFF),
    background = Color(0xFFFFFFFF),
    onBackground = Color(0xFF131514),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF131514),
    onSurfaceVariant = Color(0xFF4A4F4C),
    surfaceContainer = Color(0xFFF3F4F2),
    surfaceContainerHigh = Color(0xFFE7E9E6),
    outline = Color(0xFF7A807C),
    error = Color(0xFFB3261E),
)

private val DarkColors: ColorScheme = darkColorScheme(
    primary = Color(0xFF5FD6C2),
    onPrimary = Color(0xFF00201B),
    background = Color(0xFF000000),
    onBackground = Color(0xFFECEEEC),
    surface = Color(0xFF000000),
    onSurface = Color(0xFFECEEEC),
    onSurfaceVariant = Color(0xFFA9AEAA),
    surfaceContainer = Color(0xFF0D0E0E),
    surfaceContainerHigh = Color(0xFF191B1A),
    outline = Color(0xFF6F7571),
    error = Color(0xFFFFB4AB),
)
