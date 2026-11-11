package app.shkriuss.core.design

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Checks the contrast of every colour pair in both themes (ADR 0017,
 * CLAUDE.md "UI and accessibility"):
 *
 * - every text colour on every background: at least 4.5:1,
 * - text on accent on the accent: at least 4.5:1,
 * - the outline on every background: at least 3:1.
 *
 * A new colour token fails [everyColourTokenIsInAGroup] until it is put
 * in one of the groups below, so it can never skip the check.
 */
class ShkColorsContrastTest {
    @Test
    fun formulaGivesTheKnownValues() {
        assertEquals(21.0, contrastRatio(Color.Black, Color.White), 0.001)
        assertEquals(21.0, contrastRatio(Color.White, Color.Black), 0.001)
        assertEquals(1.0, contrastRatio(Color(0xFF777777), Color(0xFF777777)), 0.001)
        // The usual examples: #767676 is the lightest grey that passes on
        // white, #777777 just fails.
        assertEquals(4.54, contrastRatio(Color(0xFF767676), Color.White), 0.005)
        assertEquals(4.48, contrastRatio(Color(0xFF777777), Color.White), 0.005)
        // The value ADR 0017 gives for white on the light accent.
        assertEquals(6.61, contrastRatio(Color.White, Color(0xFF00695C)), 0.005)
    }

    @Test
    fun everyTextPairIsAtLeast4_5To1() {
        val pairs = TEXT.flatMap { text -> BACKGROUNDS.map { background -> text to background } } +
            (TEXT_ON_ACCENT to ACCENT)
        assertEveryPairIsAtLeast(MIN_TEXT, pairs)
    }

    @Test
    fun everyOutlinePairIsAtLeast3To1() {
        assertEveryPairIsAtLeast(MIN_OUTLINE, BACKGROUNDS.map { background -> OUTLINE to background })
    }

    @Test
    fun everyColourTokenIsInAGroup() {
        val grouped = (TEXT + BACKGROUNDS + OUTLINE + TEXT_ON_ACCENT + ACCENT).map { it.name }.toSet()
        assertEquals(
            "Put every colour token in a group in ShkColorsContrastTest, so its contrast is checked.",
            colourTokenNames(),
            grouped,
        )
    }

    /** Checks each pair, foreground first, in both themes, and lists every failure. */
    private fun assertEveryPairIsAtLeast(minimum: Double, pairs: List<Pair<Token, Token>>) {
        assertTrue("No pairs to check.", pairs.isNotEmpty())
        val failures = THEMES.flatMap { (theme, colors) ->
            pairs.mapNotNull { (foreground, background) ->
                val ratio = contrastRatio(foreground.of(colors), background.of(colors))
                if (ratio < minimum) {
                    "$theme theme: ${foreground.name} on ${background.name} is ${"%.2f".format(ratio)}:1"
                } else {
                    null
                }
            }
        }
        assertTrue(
            "These pairs are under $minimum:1:\n" + failures.joinToString("\n"),
            failures.isEmpty(),
        )
    }

    /** One colour token, by its name in [ShkColors]. */
    private class Token(val name: String, val of: (ShkColors) -> Color)

    private companion object {
        const val MIN_TEXT = 4.5
        const val MIN_OUTLINE = 3.0

        val THEMES = mapOf("light" to LightShkColors, "dark" to DarkShkColors)

        /** Colours used for text and icons on any background. */
        val TEXT = listOf(
            Token("text") { it.text },
            Token("textSecondary") { it.textSecondary },
            Token("accent") { it.accent },
            Token("error") { it.error },
            Token("success") { it.success },
            Token("warning") { it.warning },
        )

        /** Colours that text is drawn on. */
        val BACKGROUNDS = listOf(
            Token("background") { it.background },
            Token("surface") { it.surface },
            Token("surfaceHigh") { it.surfaceHigh },
        )

        val OUTLINE = Token("outline") { it.outline }
        val TEXT_ON_ACCENT = Token("textOnAccent") { it.textOnAccent }
        val ACCENT = Token("accent") { it.accent }

        /** The names of the colour properties of [ShkColors], read from the class itself. */
        fun colourTokenNames(): Set<String> =
            ShkColors::class.java.declaredFields
                .filter { !java.lang.reflect.Modifier.isStatic(it.modifiers) }
                .map { it.name }
                .toSet()
    }
}
