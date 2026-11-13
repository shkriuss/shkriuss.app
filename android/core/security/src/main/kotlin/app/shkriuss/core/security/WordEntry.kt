package app.shkriuss.core.security

import app.shkriuss.core.crypto.RecoveryWords
import app.shkriuss.core.crypto.RecoveryWordsResult
import kotlin.random.Random

/** The number of words the user confirms ("Creating it", step 3, and "The app lock", rule 2, in crypto-design.md). */
internal const val WORDS_TO_CONFIRM = 4

/** The number of words of a recovery key. */
internal const val WORD_COUNT = 24

/** Four positions from 1 to 24, picked at random and sorted, for the words the user confirms. */
internal fun confirmPositions(random: Random): List<Int> =
    (1..WORD_COUNT).shuffled(random).take(WORDS_TO_CONFIRM).sorted()

/**
 * The rules of the screen that takes all 24 words, one at a time: the
 * enter flow and the app lock's check of an app that does not keep the
 * recovery key use the same screen ("Entering it" in crypto-design.md).
 */
internal object WordEntry {
    /** All 24 words empty, the first one current. */
    fun empty(): EnterWords = EnterWords(List(WORD_COUNT) { "" }, current = 0, typed = "")

    /** The user typed [text] for the current word. */
    fun typed(screen: EnterWords, text: String): EnterWords = screen.copy(typed = text, notInList = null, doNotBelong = false)

    /** The user picked [word] for the current word. The next empty word comes next. */
    fun picked(screen: EnterWords, word: String): EnterWords {
        val words = screen.words.toMutableList().also { it[screen.current] = word }
        val next = (screen.current + 1 until WORD_COUNT).firstOrNull { words[it].isEmpty() }
            ?: words.indexOfFirst { it.isEmpty() }.takeIf { it >= 0 }
            ?: screen.current
        return EnterWords(words, next, typed = if (words[next].isEmpty()) "" else words[next])
    }

    /** The user wants to change the word at [index]. */
    fun edit(screen: EnterWords, index: Int): EnterWords =
        screen.copy(current = index, typed = screen.words[index], notInList = null, doNotBelong = false)

    /** Reads the 24 words: each in the list, and the checksum. */
    fun check(screen: EnterWords): RecoveryWordsResult = RecoveryWords.parse(screen.words.joinToString(" "))

    /** The screen that names what [result] found wrong. Only for a result that is not accepted. */
    fun problem(screen: EnterWords, result: RecoveryWordsResult): EnterWords = when (result) {
        is RecoveryWordsResult.WordNotInList -> screen.copy(current = result.position - 1, typed = "", notInList = result.position)
        else -> screen.copy(doNotBelong = true)
    }
}
