package app.shkriuss.core.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    fun aChangeOverSelectedLettersAlsoPutsInOneLetterAtMost() {
        assertNull("a word pasted over a selected word of the same length", WordInput.accept("able", "acid"))
        assertNull("a word pasted over a selected word one letter shorter", WordInput.accept("act", "acid"))
        assertNull("two letters pasted over two selected ones", WordInput.accept("abandon", "abanxyn"))
        assertEquals("one letter typed over the selected end", "ax", WordInput.accept("able", "ax"))
        assertEquals("one letter typed over one selected letter", "abxe", WordInput.accept("able", "abxe"))
        assertEquals("one letter typed in the middle", "able", WordInput.accept("ale", "able"))
        assertEquals("a letter typed twice in a row", "abb", WordInput.accept("ab", "abb"))
        assertEquals("a letter deleted in the middle", "ale", WordInput.accept("able", "ale"))
        assertEquals("a capital letter typed over a selected one", "abla", WordInput.accept("able", "ablA"))
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
    fun lettersThatStartNoWordAreFound() {
        assertFalse("nothing typed yet", WordInput.startsNoWord(""))
        assertFalse(WordInput.startsNoWord("a"))
        assertFalse(WordInput.startsNoWord("ab"))
        assertFalse("a whole word", WordInput.startsNoWord("abandon"))
        assertFalse(WordInput.startsNoWord("zoo"))
        assertTrue(WordInput.startsNoWord("abj"))
        assertTrue("no word of the list starts with x", WordInput.startsNoWord("x"))
        assertTrue("a word with one letter too many", WordInput.startsNoWord("abandonx"))
        assertEquals("then nothing can be picked", emptyList<String>(), WordInput.suggestions("abj"))
        assertNull("and the next key takes nothing", WordInput.completion("abj"))
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
