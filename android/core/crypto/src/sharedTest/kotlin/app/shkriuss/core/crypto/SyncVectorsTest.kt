package app.shkriuss.core.crypto

import app.shkriuss.core.crypto.fixtures.SoftwareHardwareKeys
import com.google.crypto.tink.subtle.EcdsaVerifyJce
import com.google.crypto.tink.subtle.EllipticCurves
import com.google.crypto.tink.subtle.Enums
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The vectors of "Sync: the account key, a statement and a signed
 * request" in crypto-design.md, computed by Tink and by this module's own
 * code. The server's tests check the same vectors in Node.js.
 */
class SyncVectorsTest {
    private val recoveryKey = TestKeys.vectorRecoveryKey()
    private val devicePublicKey = hex(
        "0460fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29f" +
            "b67903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d44622" +
            "99",
    )
    private val serverId = hex("0f0e0d0c0b0a09080706050403020100")
    private val address = "https://sync.example.workers.dev"
    private val request = DeviceJoinRequest.of(serverId, address, devicePublicKey)!!

    @Test
    fun theAccountKeyOfTheRecoveryKey() {
        assertEquals(
            "09a1f1161f66bb9f5b2222bd59305e2dc520b760cd602c035eb5bbbf9ead0ed4",
            AccountKey.privateBytes(recoveryKey).toHex(),
        )
        val (publicKey, _) = AccountKey.sign(recoveryKey, ByteArray(0))
        assertEquals("59f0ee643d495c2d326a58558728cb7a28536daa950bc8be80cff2e3eef0d3b2", publicKey.toHex())
    }

    @Test
    fun theDeviceIdIsTheStartOfTheHashOfThePublicKey() {
        assertEquals("b18b86ce1389e46de87aa4a5131ce83c", DeviceId.ofPublicKey(devicePublicKey).toHex())
    }

    @Test
    fun theJoinStatementAndItsSignature() {
        val signed = SignedJoin.sign(recoveryKey, request, TIME)
        assertEquals(135, signed.statement.size)
        assertEquals(JOIN_STATEMENT.filterNot { it.isWhitespace() }, signed.statement.toHex())
        // Ed25519 signs without randomness, so the signature is the vector's own.
        assertEquals(JOIN_SIGNATURE.filterNot { it.isWhitespace() }, signed.signature.toHex())
        assertEquals("59f0ee643d495c2d326a58558728cb7a28536daa950bc8be80cff2e3eef0d3b2", signed.accountPublicKey.toHex())
        assertEquals("b19d376f", signed.keyId.toString())
        assertEquals(TIME, signed.time)
        assertTrue(signed.isFor(request))
    }

    @Test
    fun theNameKeyIsTheRecordKeysetOfTheAppNameSync() {
        val nameKey = RecoveryKeyDeriver.nameKey(recoveryKey)
        assertEquals(listOf(recoveryKey.keyId), KeysetCodec.keyIds(nameKey))
        assertEquals(listOf(NAME_KEY), TestKeys.keyBytes(nameKey))
        val waterRecord = TestKeys.derived(recoveryKey).record
        assertTrue("another app's record key differs", TestKeys.keyBytes(waterRecord) != TestKeys.keyBytes(nameKey))
    }

    @Test
    fun theSignedBytesOfARequest() {
        val bytes = SignedRequest.bytes(
            serverId,
            DeviceId.ofPublicKey(devicePublicKey),
            REQUEST_TIME,
            RequestMethod.GET,
            "/v1/heads",
            ByteArray(0),
        )
        assertEquals(93, bytes.size)
        assertEquals(REQUEST_BYTES.filterNot { it.isWhitespace() }, bytes.toHex())
    }

    @Test
    fun theVectorsRequestSignatureFitsItsDeviceKey() {
        val verifier = EcdsaVerifyJce(
            EllipticCurves.getEcPublicKey(
                EllipticCurves.CurveType.NIST_P256,
                EllipticCurves.PointFormatType.UNCOMPRESSED,
                devicePublicKey,
            ),
            Enums.HashType.SHA256,
            EllipticCurves.EcdsaEncoding.IEEE_P1363,
        )
        verifier.verify(hex(REQUEST_SIGNATURE.filterNot { it.isWhitespace() }), hex(REQUEST_BYTES.filterNot { it.isWhitespace() }))
    }

    @Test
    fun aSealedNameOpensWithTheNameKey() {
        val hardware = SoftwareHardwareKeys()
        val sync = TestKeys.syncApp(hardware)
        sync.sync.storeNameKey(SignedJoin.sign(recoveryKey, request, TIME))
        val deviceId = DeviceId.ofPublicKey(devicePublicKey)
        assertEquals("Pixel 9 Pro", sync.sync.openName(deviceId, hex(SEALED_NAME.filterNot { it.isWhitespace() })))

        val sealed = sync.sync.sealName(deviceId, "Pixel 9 Pro")
        assertEquals(50 + 12, sealed.size)
        assertArrayEquals(hex("53484b010101b19d376f"), sealed.copyOfRange(0, 10))
    }

    private companion object {
        const val TIME = 1_767_225_600_000L
        const val REQUEST_TIME = 1_767_225_660_000L

        const val NAME_KEY = "645600ae76271c4ebf4d5255e3b2348f90c05207da737b49b7c570c27c3ba9a4"

        const val JOIN_STATEMENT = """
            53484b53594e4301010f0e0d0c0b0a09080706050403020100b19d376f000001
            9b76daa8002068747470733a2f2f73796e632e6578616d706c652e776f726b65
            72732e6465760460fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce6
            69622e60f29fb67903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177
            a3c294d4462299
            """

        const val JOIN_SIGNATURE = """
            42f7cfec0f61f657951108eb309a24cd6b1f7af049cea9951dbfe232c7a0cf2d
            5fd7f6fc42cc00eb6bced8a54c0d139a9b5121953259cf55574844ec076e5907
            """

        const val REQUEST_BYTES = """
            53484b53594e4301100f0e0d0c0b0a09080706050403020100b18b86ce1389e4
            6de87aa4a5131ce83c0000019b76db92600100092f76312f6865616473e3b0c4
            4298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
            """

        const val REQUEST_SIGNATURE = """
            2d55454e770f3f27f5cb83e3869fcb76acb563a7f86e0dbcecf2cef843825bf9
            b75946bff6aebbcb477595a46515b46e56580bf4b60b8ad9fdb5d31550b58f72
            """

        const val SEALED_NAME = """
            53484b010101b19d376f0a06008d2574b58f5bca24e039f577a59182f8e48f82
            9495ba56270ac7f093080a0e1b47e21c4251f5283d2ea71c18c10a28ef52
            """
    }
}
