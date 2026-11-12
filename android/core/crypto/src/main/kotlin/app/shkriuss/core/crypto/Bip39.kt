package app.shkriuss.core.crypto

import java.security.MessageDigest

/**
 * The BIP-39 encoding of 32 bytes as 24 English words ("The words" in
 * crypto-design.md). Only the encoding is used. The BIP-39 seed is not.
 *
 * The word list is `english.txt` from Trezor's python-mnemonic, MIT
 * licence. The licence text sits next to it in this module's resources.
 */
internal object Bip39 {
    /** The number of words for 32 bytes. */
    const val WORD_COUNT = 24

    private const val RESOURCE = "/app/shkriuss/core/crypto/words/english.txt"
    private const val LIST_SIZE = 2048
    private const val BITS_PER_WORD = 11

    /** The word list file, byte for byte, so a test can check its hash. */
    fun wordListBytes(): ByteArray {
        val stream = Bip39::class.java.getResourceAsStream(RESOURCE)
            ?: throw IllegalStateException("The word list is missing from the app")
        return stream.use { it.readBytes() }
    }

    /** The 2048 words, in the order of the list. A word's place is its number. */
    val words: List<String> by lazy {
        val list = String(wordListBytes(), Charsets.US_ASCII).split('\n').filter { it.isNotEmpty() }
        check(list.size == LIST_SIZE) { "The word list must hold 2048 words" }
        list
    }

    private val numberOfWord: Map<String, Int> by lazy { words.withIndex().associate { it.value to it.index } }

    /** The number of [word] in the list, or null if it is not in the list. */
    fun numberOf(word: String): Int? = numberOfWord[word]

    /** The 24 words for 32 bytes: the bytes, then one checksum byte, cut into groups of 11 bits. */
    fun encode(entropy: ByteArray): List<String> {
        require(entropy.size == KeysetCodec.KEY_BYTES) { "A recovery key is 32 bytes" }
        val bits = entropy + checksum(entropy)
        try {
            return List(WORD_COUNT) { words[readGroup(bits, it)] }
        } finally {
            bits.fill(0)
        }
    }

    /**
     * The 32 bytes for 24 word numbers, or null if the checksum byte is
     * wrong. [numbers] must hold 24 numbers from 0 to 2047.
     */
    fun decode(numbers: List<Int>): ByteArray? {
        require(numbers.size == WORD_COUNT) { "A recovery key is 24 words" }
        val bits = ByteArray(KeysetCodec.KEY_BYTES + 1)
        numbers.forEachIndexed { index, number -> writeGroup(bits, index, number) }
        val entropy = bits.copyOf(KeysetCodec.KEY_BYTES)
        val matches = bits[KeysetCodec.KEY_BYTES] == checksum(entropy)
        bits.fill(0)
        if (!matches) {
            entropy.fill(0)
            return null
        }
        return entropy
    }

    /** The first byte of the SHA-256 of [entropy]. It is a checksum, not a secret. */
    private fun checksum(entropy: ByteArray): Byte = MessageDigest.getInstance("SHA-256").digest(entropy)[0]

    private fun readGroup(bits: ByteArray, group: Int): Int {
        var value = 0
        for (bit in 0 until BITS_PER_WORD) {
            val position = group * BITS_PER_WORD + bit
            val one = (bits[position / 8].toInt() ushr (7 - position % 8)) and 1
            value = (value shl 1) or one
        }
        return value
    }

    private fun writeGroup(bits: ByteArray, group: Int, value: Int) {
        for (bit in 0 until BITS_PER_WORD) {
            val position = group * BITS_PER_WORD + bit
            val one = (value ushr (BITS_PER_WORD - 1 - bit)) and 1
            bits[position / 8] = (bits[position / 8].toInt() or (one shl (7 - position % 8))).toByte()
        }
    }
}
