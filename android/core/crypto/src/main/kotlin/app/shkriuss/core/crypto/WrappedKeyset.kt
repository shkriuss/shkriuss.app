package app.shkriuss.core.crypto

/**
 * A keyset wrapped by a hardware key (kind 5): the header, the kind and
 * the number of the hardware key, then exactly what the Keystore returns:
 * a 12-byte IV, the ciphertext and a 16-byte tag.
 */
internal object WrappedKeyset {
    /** The header, the hardware key kind and the hardware key number. */
    const val PREFIX_SIZE = Header.SIZE + 1 + 4

    /** The IV the Keystore picks. */
    const val IV_SIZE = 12

    private const val TAG_SIZE = 16
    private const val KIND_OFFSET = Header.SIZE
    private const val NUMBER_OFFSET = Header.SIZE + 1

    /** The first ten bytes of a blob wrapped by [key]. They are also the start of its associated data. */
    fun prefix(key: HardwareKeyRef): ByteArray =
        Header.of(BlobKind.WRAPPED_KEYSET) + key.kind.number.toByte() + KeyId(key.number).toBytes()

    /**
     * The hardware key that [blob] names, after these checks: the header,
     * the length, a kind from 1 to 4, a number from 1, and that this kind
     * of key may wrap the keyset [name]. Throws [BlobException].
     */
    fun keyOf(blob: ByteArray, name: KeysetName): HardwareKeyRef {
        Header.check(blob, blob.size, BlobKind.WRAPPED_KEYSET)
        if (blob.size < PREFIX_SIZE + IV_SIZE + TAG_SIZE) throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        val kind = HardwareKeyKind.ofNumber(blob[KIND_OFFSET].toInt() and 0xff)
        val number = KeyId.fromBytes(blob, NUMBER_OFFSET).value
        if (kind == null || number < 1 || !kind.mayWrap(name)) throw BlobException(BlobAnswer.DAMAGED_OR_CHANGED)
        return HardwareKeyRef(kind, number)
    }

    /** The IV of a wrapped keyset. A key that needs the prompt must get it before it decrypts. */
    fun iv(blob: ByteArray): ByteArray = blob.copyOfRange(PREFIX_SIZE, PREFIX_SIZE + IV_SIZE)

    /** The IV, the ciphertext and the tag: what a key that needs no prompt decrypts. */
    fun afterPrefix(blob: ByteArray): ByteArray = blob.copyOfRange(PREFIX_SIZE, blob.size)

    /** The ciphertext and the tag: what a started cipher decrypts. */
    fun afterIv(blob: ByteArray): ByteArray = blob.copyOfRange(PREFIX_SIZE + IV_SIZE, blob.size)
}
