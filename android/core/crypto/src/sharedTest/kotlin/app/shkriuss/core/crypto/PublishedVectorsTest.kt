package app.shkriuss.core.crypto

import com.google.crypto.tink.subtle.Hkdf
import com.google.crypto.tink.subtle.XChaCha20Poly1305
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Vectors that others published, run against the Tink code this module
 * uses (item 1 of "What the tests must cover" in crypto-design.md).
 */
class PublishedVectorsTest {
    @Test
    fun hkdfSha256Rfc5869Case1() {
        val key = Hkdf.computeHkdf(
            "HMACSHA256",
            hex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"),
            hex("000102030405060708090a0b0c"),
            hex("f0f1f2f3f4f5f6f7f8f9"),
            42,
        )
        assertEquals(
            "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
            key.toHex(),
        )
    }

    @Test
    fun hkdfSha256Rfc5869Case2() {
        val key = Hkdf.computeHkdf(
            "HMACSHA256",
            hex(
                """
                000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
                202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f
                404142434445464748494a4b4c4d4e4f
                """,
            ),
            hex(
                """
                606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f
                808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f
                a0a1a2a3a4a5a6a7a8a9aaabacadaeaf
                """,
            ),
            hex(
                """
                b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecf
                d0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeef
                f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff
                """,
            ),
            82,
        )
        assertEquals(
            "b11e398dc80327a1c8e7f78c596a49344f012eda2d4efad8a050cc4c19afa97c" +
                "59045a99cac7827271cb41c65e590e09da3275600c2f09b8367793a9aca3db71" +
                "cc30c58179ec3e87c14c01d5c1f3434f1d87",
            key.toHex(),
        )
    }

    @Test
    fun hkdfSha256Rfc5869Case3() {
        val key = Hkdf.computeHkdf(
            "HMACSHA256",
            hex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"),
            ByteArray(0),
            ByteArray(0),
            42,
        )
        assertEquals(
            "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8",
            key.toHex(),
        )
    }

    /** draft-irtf-cfrg-xchacha-03, appendix A.3.1. Tink's layout is nonce, ciphertext, tag. */
    @Test
    fun xChaCha20Poly1305DraftVector() {
        val key = hex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f")
        val nonce = hex("404142434445464748494a4b4c4d4e4f5051525354555657")
        val associatedData = hex("50515253c0c1c2c3c4c5c6c7")
        val ciphertext = hex(
            """
            bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb
            731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b452
            2f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff9
            21f9664c97637da9768812f615c68b13b52e
            """,
        )
        val tag = hex("c0875924c1c7987947deafd8780acf49")

        val plaintext = XChaCha20Poly1305(key).decrypt(nonce + ciphertext + tag, associatedData)

        assertEquals(
            "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, " +
                "sunscreen would be it.",
            String(plaintext, Charsets.US_ASCII),
        )
    }
}
