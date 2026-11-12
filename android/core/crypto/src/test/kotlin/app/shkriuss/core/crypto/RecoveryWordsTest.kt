package app.shkriuss.core.crypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The words of a recovery key (item 5 of "What the tests must cover" in
 * crypto-design.md): the published BIP-39 vectors, wrong input, and the
 * word list itself.
 */
class RecoveryWordsTest {
    private val published = listOf(
        "00".repeat(32) to List(23) { "abandon" }.plus("art").joinToString(" "),
        "7f".repeat(32) to
            "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful " +
            "legal winner thank year wave sausage worth title",
        "80".repeat(32) to
            "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor " +
            "acoustic avoid letter advice cage absurd amount doctor acoustic bless",
        "ff".repeat(32) to List(23) { "zoo" }.plus("vote").joinToString(" "),
    )

    @Test
    fun publishedVectorsFromBytesToWords() {
        published.forEach { (bytes, words) ->
            assertEquals(words, RecoveryKey.ofBytes(hex(bytes)).words().joinToString(" "))
        }
    }

    @Test
    fun publishedVectorsFromWordsToBytes() {
        published.forEach { (bytes, words) ->
            val expected = RecoveryKey.ofBytes(hex(bytes))
            val parsed = RecoveryWords.parse(words) as RecoveryWordsResult.Accepted
            assertTrue(parsed.recoveryKey.sameKeyAs(expected))
            assertEquals(expected.keyId, parsed.recoveryKey.keyId)
        }
    }

    @Test
    fun aWrongChecksumIsRefused() {
        val words = List(24) { "abandon" }.joinToString(" ")
        assertEquals(RecoveryWordsResult.DoNotBelongTogether, RecoveryWords.parse(words))
    }

    @Test
    fun twoWordsSwappedAreRefused() {
        val words = TestKeys.vectorRecoveryKey().words().toMutableList()
        words[0] = words[1].also { words[1] = words[0] }
        assertEquals(RecoveryWordsResult.DoNotBelongTogether, RecoveryWords.parse(words.joinToString(" ")))
    }

    @Test
    fun aWordThatIsNotInTheListIsNamedByItsPosition() {
        val words = TestKeys.vectorRecoveryKey().words().toMutableList()
        words[6] = "shkriuss"
        words[20] = "nothing!"
        val result = RecoveryWords.parse(words.joinToString(" ")) as RecoveryWordsResult.WordNotInList
        assertEquals(7, result.position)
    }

    @Test
    fun onlyWholeWordsCount() {
        // The first four letters are enough for the entry field to offer the word. They are not the word.
        val words = TestKeys.vectorRecoveryKey().words().toMutableList()
        words[0] = "aban"
        assertEquals(1, (RecoveryWords.parse(words.joinToString(" ")) as RecoveryWordsResult.WordNotInList).position)
    }

    @Test
    fun aWrongNumberOfWordsIsRefused() {
        val words = TestKeys.vectorRecoveryKey().words()
        listOf(emptyList(), words.take(1), words.take(23), words + "abandon").forEach { wrong ->
            assertEquals(RecoveryWordsResult.DoNotBelongTogether, RecoveryWords.parse(wrong.joinToString(" ")))
        }
    }

    @Test
    fun upperCaseAndExtraSpacesDoNotMatter() {
        val key = TestKeys.vectorRecoveryKey()
        val typed = "  \t" + key.words().joinToString("  \n ") { it.uppercase() } + " \n"
        val parsed = RecoveryWords.parse(typed) as RecoveryWordsResult.Accepted
        assertTrue(parsed.recoveryKey.sameKeyAs(key))
    }

    @Test
    fun theWordListIsTheOneOfCryptoDesign() {
        assertEquals(
            "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda",
            TestKeys.sha256(Bip39.wordListBytes()),
        )
        assertEquals(2048, RecoveryWords.list.size)
        assertEquals("abandon", RecoveryWords.list.first())
        assertEquals("zoo", RecoveryWords.list.last())
    }

    @Test
    fun theFirstFourLettersOfAWordAreEnoughToKnowIt() {
        assertEquals(2048, RecoveryWords.list.map { it.take(4) }.toSet().size)
    }

    @Test
    fun aNewRecoveryKeyComesBackFromItsWords() {
        val key = RecoveryKey.newRandom()
        val parsed = RecoveryWords.parse(key.words().joinToString(" ")) as RecoveryWordsResult.Accepted
        assertTrue(parsed.recoveryKey.sameKeyAs(key))
        assertFalse(RecoveryKey.newRandom().sameKeyAs(key))
    }

    @Test
    fun fourOfTheWordsAreCheckedByPosition() {
        val key = TestKeys.vectorRecoveryKey()
        val words = key.words()
        assertTrue(key.hasWordsAt(mapOf(1 to words[0], 7 to " ${words[6].uppercase()} ", 13 to words[12], 24 to words[23])))
        assertFalse(key.hasWordsAt(mapOf(1 to words[0], 7 to words[7])))
        assertFalse(key.hasWordsAt(mapOf(0 to words[0])))
        assertFalse(key.hasWordsAt(mapOf(25 to words[0])))
        assertFalse(key.hasWordsAt(emptyMap()))
    }
}
