package app.shkriuss.core.crypto

import com.google.crypto.tink.InsecureSecretKeyAccess
import com.google.crypto.tink.KeysetHandle
import com.google.crypto.tink.RegistryConfiguration
import com.google.crypto.tink.prf.HkdfPrfKey
import com.google.crypto.tink.prf.HkdfPrfParameters
import com.google.crypto.tink.prf.PrfSet
import com.google.crypto.tink.util.SecretBytes
import java.util.Locale

/**
 * A recovery key: 32 random bytes, the root of a user's account. Whoever
 * has it can read every backup and all synced data.
 *
 * It is held as a Tink key, never as text. Code that gets one uses it and
 * drops every reference: it is in memory only while it is created,
 * entered, shown, or used to derive keys.
 */
class RecoveryKey internal constructor(internal val prfKey: HkdfPrfKey) {
    /** The four public bytes that name this recovery key. */
    val keyId: KeyId by lazy { computeKeyId() }

    /**
     * The 24 words that stand for this key, in order. They are the key.
     * Show them only on a screen that blocks screenshots, and never log
     * them or put them on the clipboard.
     */
    fun words(): List<String> {
        val bytes = prfKey.keyBytes.toByteArray(InsecureSecretKeyAccess.get())
        try {
            return Bip39.encode(bytes)
        } finally {
            bytes.fill(0)
        }
    }

    /**
     * True if every answer is the word at its position. Positions count
     * from 1 to 24. This is how the app checks that the paper copy exists:
     * it asks for four of the words at positions it picks at random.
     */
    fun hasWordsAt(answers: Map<Int, String>): Boolean {
        val words = words()
        return answers.isNotEmpty() && answers.all { (position, answer) ->
            position in 1..words.size && RecoveryWords.normalise(answer) == words[position - 1]
        }
    }

    /** True if [other] is the same recovery key. */
    internal fun sameKeyAs(other: RecoveryKey): Boolean = prfKey.equalsKey(other.prfKey)

    /** The key ID is four bytes of HKDF output under its own label, through Tink's PRF. */
    private fun computeKeyId(): KeyId {
        TinkSetup.ready()
        val keyset = KeysetHandle.newBuilder()
            .addEntry(KeysetHandle.importKey(prfKey).withFixedId(1).makePrimary())
            .build()
        val prf = keyset.getPrimitive(RegistryConfiguration.get(), PrfSet::class.java)
        return KeyId.fromBytes(prf.computePrimary(KEY_ID_LABEL.toByteArray(Charsets.US_ASCII), KEY_ID_BYTES))
    }

    /** Never shows the key. */
    override fun toString(): String = "RecoveryKey"

    internal companion object {
        private const val KEY_ID_LABEL = "shkriuss.app/v1/key-id"
        private const val KEY_ID_BYTES = 4

        /** A new recovery key: 32 bytes from Tink's random source, made by Tink as a new `HkdfPrfKey`. */
        fun newRandom(): RecoveryKey =
            RecoveryKey(KeysetCodec.newRandom(KeysetType.RECOVERY).getAt(0).key as HkdfPrfKey)

        /** The recovery key with these 32 bytes. The caller wipes [bytes]. */
        fun ofBytes(bytes: ByteArray): RecoveryKey {
            TinkSetup.ready()
            val key = HkdfPrfKey.builder()
                .setParameters(KeysetType.RECOVERY.parameters as HkdfPrfParameters)
                .setKeyBytes(SecretBytes.copyFrom(bytes, InsecureSecretKeyAccess.get()))
                .build()
            return RecoveryKey(key)
        }
    }
}

/** What [RecoveryWords.parse] found in the text a user typed. */
sealed class RecoveryWordsResult {
    /** The words are a recovery key. */
    class Accepted internal constructor(val recoveryKey: RecoveryKey) : RecoveryWordsResult() {
        override fun toString(): String = "Accepted"
    }

    /** "Word 7 is not in the word list." [position] counts from 1. */
    class WordNotInList internal constructor(val position: Int) : RecoveryWordsResult() {
        override fun toString(): String = "WordNotInList($position)"
    }

    /** "These words do not belong together. Check each word." Also for a wrong number of words. */
    object DoNotBelongTogether : RecoveryWordsResult() {
        override fun toString(): String = "DoNotBelongTogether"
    }
}

/**
 * The words of a recovery key: the BIP-39 English list and how typed text
 * is read. The words are English in every app language.
 */
object RecoveryWords {
    /** The 2048 words, for the entry field to offer. The first four letters of a word are enough to know it. */
    val list: List<String> get() = Bip39.words

    /**
     * Reads the words a user typed. Spaces around and between the words
     * and upper case do not matter. It gives one of two complaints and
     * nothing more: the first word that is not in the list, or that the
     * words do not belong together.
     */
    fun parse(text: String): RecoveryWordsResult {
        val typed = text.trim().split(WHITE_SPACE).filter { it.isNotEmpty() }.map { normalise(it) }
        val numbers = typed.map { Bip39.numberOf(it) }
        val unknown = numbers.indexOfFirst { it == null }
        if (unknown >= 0) return RecoveryWordsResult.WordNotInList(unknown + 1)
        if (numbers.size != Bip39.WORD_COUNT) return RecoveryWordsResult.DoNotBelongTogether
        val bytes = Bip39.decode(numbers.filterNotNull()) ?: return RecoveryWordsResult.DoNotBelongTogether
        try {
            return RecoveryWordsResult.Accepted(RecoveryKey.ofBytes(bytes))
        } finally {
            bytes.fill(0)
        }
    }

    /** A typed word without spaces around it, in lower case. */
    internal fun normalise(word: String): String = word.trim().lowercase(Locale.ROOT)

    private val WHITE_SPACE = Regex("""\s+""")
}
