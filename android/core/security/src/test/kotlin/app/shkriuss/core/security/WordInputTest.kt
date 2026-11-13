package app.shkriuss.core.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** What a field for one recovery word accepts, and what it offers. */
class WordInputTest {
    @Test
    fun onlyLettersOneAtATimeAndAtMostEight() {
        assertEquals("a", WordInput.accept("", "A"))
        assertEquals("ab", WordInput.accept("a", "ab"))
        assertNull("a digit", WordInput.accept("a", "a1"))
        assertNull("a space", WordInput.accept("a", "a "))
        assertNull("a letter of another alphabet", WordInput.accept("", "ä"))
        assertNull("two letters at once: a paste", WordInput.accept("", "ab"))
        assertNull("a whole phrase at once", WordInput.accept("", "abandon ability"))
        assertNull("more than eight letters", WordInput.accept("abcdefgh", "abcdefghi"))
        assertEquals("deleting many letters at once is fine", "", WordInput.accept("abandon", ""))
        assertEquals("i", WordInput.accept("", "I"))
    }

    @Test
    fun suggestionsStartAtTwoLettersAndAreAtMostFour() {
        assertEquals(emptyList<String>(), WordInput.suggestions(""))
        assertEquals(emptyList<String>(), WordInput.suggestions("a"))
        val ab = WordInput.suggestions("ab")
        assertTrue(ab.size in 1..4)
        assertTrue(ab.all { it.startsWith("ab") })
        assertEquals(listOf("abandon"), WordInput.suggestions("aban"))
        assertEquals(emptyList<String>(), WordInput.suggestions("xq"))
    }

    @Test
    fun aWordOrItsFirstFourLettersAreEnough() {
        assertEquals("abandon", WordInput.completion("aban"))
        assertEquals("abandon", WordInput.completion("abandon"))
        assertEquals("act", WordInput.completion("act"))
        assertNull("three letters of a longer word", WordInput.completion("aba"))
        assertNull("not a word", WordInput.completion("zzzz"))
    }
}
