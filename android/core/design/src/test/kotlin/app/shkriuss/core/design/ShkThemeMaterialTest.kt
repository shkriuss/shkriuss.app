package app.shkriuss.core.design

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Checks how [ShkTheme] sets up Material 3, which the `Shk*` components
 * are built on:
 *
 * - every Material 3 colour is a token of the same theme, so no colour of
 *   Material's own baseline palette can show up,
 * - Material 3's text on its containers keeps 4.5:1, and its outlines 3:1,
 * - every Material 3 text style is one of the six, and every corner size
 *   one of the suite's shapes.
 */
class ShkThemeMaterialTest {
    @Test
    fun everyMaterialColourIsATokenOfItsTheme() {
        val failures = THEMES.flatMap { theme ->
            materialColours(theme.scheme)
                .filterValues { it !in theme.allowedColours }
                .keys
                .map { role -> "${theme.name} theme: $role" }
        }
        assertTrue(
            "These Material 3 colours are not tokens of their theme:\n" + failures.joinToString("\n"),
            failures.isEmpty(),
        )
    }

    @Test
    fun readsEveryMaterialColour() {
        // Guards the reflection in materialColours: Material 3 1.4 has 48
        // colour roles.
        assertTrue(materialColours(LightColorScheme).size >= 48)
    }

    @Test
    fun materialTextOnItsContainersIsAtLeast4_5To1() {
        assertEveryPairIsAtLeast(4.5, TEXT_PAIRS)
    }

    @Test
    fun materialOutlinesAreAtLeast3To1() {
        val pairs = SURFACES.flatMap { (name, surface) ->
            listOf(
                MaterialPair("outline on $name", { it.outline }, surface),
                MaterialPair("outlineVariant on $name", { it.outlineVariant }, surface),
            )
        }
        assertEveryPairIsAtLeast(3.0, pairs)
    }

    @Test
    fun everyMaterialTextStyleIsOneOfTheSix() {
        val six = ShkTextStyle.entries.map { it.textStyle }
        val styles = with(MaterialTypography) {
            listOf(
                displayLarge, displayMedium, displaySmall,
                headlineLarge, headlineMedium, headlineSmall,
                titleLarge, titleMedium, titleSmall,
                bodyLarge, bodyMedium, bodySmall,
                labelLarge, labelMedium, labelSmall,
            )
        }
        styles.forEach { assertTrue("$it is not one of the six styles", it in six) }
    }

    @Test
    fun everyMaterialShapeIsASuiteShape() {
        val suite = listOf(ShkShapes.Pill, ShkShapes.Field, ShkShapes.Card, ShkShapes.Sheet)
        val shapes = with(MaterialShapes) { listOf(extraSmall, small, medium, large, extraLarge) }
        shapes.forEach { assertTrue("$it is not a suite shape", it in suite) }
    }

    @Test
    fun textStylesHaveTheSizesOfAdr0017() {
        val sizes = ShkTextStyle.entries.associate { it.name to (it.fontSize.value to it.lineHeight.value) }
        assertEquals(
            mapOf(
                "Headline" to (24f to 32f),
                "Title" to (20f to 28f),
                "Subtitle" to (16f to 24f),
                "Body" to (14f to 20f),
                "Label" to (14f to 20f),
                "Caption" to (12f to 16f),
            ),
            sizes,
        )
    }

    private fun assertEveryPairIsAtLeast(minimum: Double, pairs: List<MaterialPair>) {
        val failures = THEMES.flatMap { theme ->
            pairs.mapNotNull { pair ->
                val ratio = contrastRatio(pair.content(theme.scheme), pair.container(theme.scheme))
                if (ratio < minimum) "${theme.name} theme: ${pair.name} is ${"%.2f".format(ratio)}:1" else null
            }
        }
        assertTrue("Under $minimum:1:\n" + failures.joinToString("\n"), failures.isEmpty())
    }

    /** One theme: its tokens, and the Material 3 colours made from them. */
    private class Theme(val name: String, colors: ShkColors, val scheme: ColorScheme, other: ShkColors) {
        /** Its own tokens, black for the scrim, and the other theme's accent for the inverse roles. */
        val allowedColours: Set<Color> = with(colors) {
            setOf(
                background, surface, surfaceHigh, text, textSecondary, outline,
                accent, textOnAccent, error, success, warning,
                Color.Black, other.accent,
            )
        }
    }

    /** A Material 3 colour drawn on another one, such as text on a button. */
    private class MaterialPair(
        val name: String,
        val content: (ColorScheme) -> Color,
        val container: (ColorScheme) -> Color,
    )

    private companion object {
        val THEMES = listOf(
            Theme("light", LightShkColors, LightColorScheme, DarkShkColors),
            Theme("dark", DarkShkColors, DarkColorScheme, LightShkColors),
        )

        /**
         * Every colour role of a Material 3 colour scheme, by name. Read
         * through reflection, so a role added by a Material 3 update is
         * checked too. A colour is a `long` to the JVM.
         */
        fun materialColours(scheme: ColorScheme): Map<String, Color> =
            ColorScheme::class.java.methods
                .filter { it.name.startsWith("get") && it.parameterCount == 0 }
                .filter { it.returnType == Long::class.javaPrimitiveType }
                .associate { it.name.substringBefore('-') to Color((it.invoke(scheme) as Long).toULong()) }

        /** The surfaces Material 3 draws text and outlines on. */
        val SURFACES: Map<String, (ColorScheme) -> Color> = mapOf(
            "background" to { it.background },
            "surface" to { it.surface },
            "surfaceVariant" to { it.surfaceVariant },
            "surfaceContainerLowest" to { it.surfaceContainerLowest },
            "surfaceContainerLow" to { it.surfaceContainerLow },
            "surfaceContainer" to { it.surfaceContainer },
            "surfaceContainerHigh" to { it.surfaceContainerHigh },
            "surfaceContainerHighest" to { it.surfaceContainerHighest },
            "surfaceDim" to { it.surfaceDim },
            "surfaceBright" to { it.surfaceBright },
        )

        /** Text and icon colours on what Material 3 draws them on. */
        val TEXT_PAIRS: List<MaterialPair> = SURFACES.flatMap { (name, surface) ->
            listOf(
                MaterialPair("onSurface on $name", { it.onSurface }, surface),
                MaterialPair("onSurfaceVariant on $name", { it.onSurfaceVariant }, surface),
                MaterialPair("primary on $name", { it.primary }, surface),
                MaterialPair("error on $name", { it.error }, surface),
            )
        } + listOf(
            MaterialPair("onBackground on background", { it.onBackground }, { it.background }),
            MaterialPair("onPrimary on primary", { it.onPrimary }, { it.primary }),
            MaterialPair("onPrimaryContainer on primaryContainer", { it.onPrimaryContainer }, { it.primaryContainer }),
            MaterialPair("onSecondary on secondary", { it.onSecondary }, { it.secondary }),
            MaterialPair("onSecondaryContainer on secondaryContainer", { it.onSecondaryContainer }, { it.secondaryContainer }),
            MaterialPair("onTertiary on tertiary", { it.onTertiary }, { it.tertiary }),
            MaterialPair("onTertiaryContainer on tertiaryContainer", { it.onTertiaryContainer }, { it.tertiaryContainer }),
            MaterialPair("onError on error", { it.onError }, { it.error }),
            MaterialPair("onErrorContainer on errorContainer", { it.onErrorContainer }, { it.errorContainer }),
            MaterialPair("inverseOnSurface on inverseSurface", { it.inverseOnSurface }, { it.inverseSurface }),
            MaterialPair("inversePrimary on inverseSurface", { it.inversePrimary }, { it.inverseSurface }),
            MaterialPair("onPrimaryFixed on primaryFixed", { it.onPrimaryFixed }, { it.primaryFixed }),
            MaterialPair("onPrimaryFixedVariant on primaryFixedDim", { it.onPrimaryFixedVariant }, { it.primaryFixedDim }),
            MaterialPair("onSecondaryFixed on secondaryFixed", { it.onSecondaryFixed }, { it.secondaryFixed }),
            MaterialPair("onSecondaryFixedVariant on secondaryFixedDim", { it.onSecondaryFixedVariant }, { it.secondaryFixedDim }),
            MaterialPair("onTertiaryFixed on tertiaryFixed", { it.onTertiaryFixed }, { it.tertiaryFixed }),
            MaterialPair("onTertiaryFixedVariant on tertiaryFixedDim", { it.onTertiaryFixedVariant }, { it.tertiaryFixedDim }),
        )
    }
}
