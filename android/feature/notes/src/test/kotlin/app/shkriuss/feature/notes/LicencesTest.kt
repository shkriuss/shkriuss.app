package app.shkriuss.feature.notes

import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The third-party parts the Licences screen lists (docs/apps/water/spec.md,
 * "Licences", as Notes' spec says): each has a name, a notice and the
 * full text of its licence, and each licence text in the app is byte for
 * byte the one of its source. The SHA-256 values are those recorded in
 * docs/development/third-party.md.
 */
@RunWith(RobolectricTestRunner::class)
class LicencesTest {
    private val resources = context.resources

    private fun bytes(id: Int): ByteArray = resources.openRawResource(id).use { it.readBytes() }

    private fun sha256(id: Int): String = MessageDigest.getInstance("SHA-256").digest(bytes(id)).joinToString("") { "%02x".format(it) }

    private fun name(part: LicensedPart): String = resources.getString(part.name)

    @Test
    fun everyPartHasANameANoticeAndALicence() {
        assertEquals("the seven parts that ship, as third-party.md lists them", 7, Licences.parts.size)
        Licences.parts.forEach { part ->
            assertTrue(part.id, name(part).isNotBlank())
            assertTrue("${part.id} names its licence", resources.getString(part.licence).isNotBlank())
            val notice = String(bytes(part.notice))
            assertTrue("${part.id} says whose it is", notice.contains("Copyright"))
            assertTrue("${part.id} says where it comes from", notice.contains("Source: "))
            assertTrue("${part.id} has the full text of its licence", bytes(part.text).size > 1_000)
        }
    }

    @Test
    fun thePartsAreListedByNameAndEachOnce() {
        val names = Licences.parts.map(::name)
        assertEquals(names.sortedBy { it.lowercase() }, names)
        assertEquals(names.size, names.toSet().size)
        assertEquals(Licences.parts.size, Licences.parts.map { it.id }.toSet().size)
    }

    @Test
    fun aPartIsFoundByItsId() {
        assertNotNull(Licences.part("tink"))
        assertNull(Licences.part("no such part"))
        assertNull(Licences.part(null))
    }

    @Test
    fun theApacheLicenceIsTheTextOfApacheOrg() {
        assertEquals("cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30", sha256(R.raw.notes_licence_apache_2_0))
        val apache = Licences.parts.filter { resources.getString(it.licence) == "Apache License 2.0" }
        assertEquals(5, apache.size)
        apache.forEach { assertEquals(it.id, R.raw.notes_licence_apache_2_0, it.text) }
    }

    @Test
    fun theOtherLicencesAreTheFilesOfTheirSources() {
        assertEquals("6e5e117324afd944dcf67f36cf329843bc1a92229a8cd9bb573d7a83130fea7d", sha256(R.raw.notes_licence_protobuf))
        // The licence file that ships next to the word list in core/crypto, which is the source's own.
        assertEquals("d5e3c7c62a84e80073201e2f6e5130e9e6804fa05f8ac4f8b26a13c7d3969697", sha256(R.raw.notes_licence_bip39))
    }

    @Test
    fun theLicenceOfTheWordListIsTheOneThatShipsWithTheList() {
        val shipped = checkNotNull(javaClass.getResourceAsStream("/app/shkriuss/core/crypto/words/LICENSE.txt")) {
            "The word list's licence is not on the class path"
        }.use { it.readBytes() }
        assertTrue(shipped.contentEquals(bytes(R.raw.notes_licence_bip39)))
    }
}
