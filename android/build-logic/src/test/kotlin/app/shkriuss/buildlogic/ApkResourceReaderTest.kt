package app.shkriuss.buildlogic

import app.shkriuss.buildlogic.ApkResourceReader.TYPE_INT_BOOLEAN
import app.shkriuss.buildlogic.ApkResourceReader.TYPE_REFERENCE
import app.shkriuss.buildlogic.ApkResourceReader.TYPE_STRING
import app.shkriuss.buildlogic.BinaryResourceWriter.Element
import app.shkriuss.buildlogic.BinaryResourceWriter.Entry
import app.shkriuss.buildlogic.BinaryResourceWriter.Offsets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Shows that [ApkResourceReader] reads binary XML and resource tables in
 * every layout it claims to read, and refuses what it cannot read.
 */
class ApkResourceReaderTest {
    private val manifest = Element(
        "manifest",
        children = listOf(
            Element(
                "application",
                attributes = listOf(
                    BinaryResourceWriter.android("allowBackup", 0x01010280, TYPE_INT_BOOLEAN, 0),
                    BinaryResourceWriter.android("dataExtractionRules", 0x0101063e, TYPE_REFERENCE, 0x7f020001),
                    BinaryResourceWriter.plain("note", "x".repeat(200)),
                ),
                children = listOf(Element("activity"), Element("provider")),
            ),
        ),
    )

    private fun assertManifestRead(root: ApkResourceReader.XmlElement) {
        assertEquals("manifest", root.name)
        val application = root.children.single()
        assertEquals("application", application.name)
        assertEquals(listOf("activity", "provider"), application.children.map { it.name })
        val allowBackup = application.androidAttribute(0x01010280, "allowBackup")!!
        assertEquals(TYPE_INT_BOOLEAN, allowBackup.type)
        assertEquals(0, allowBackup.data)
        assertEquals(ApkResourceReader.ANDROID_NAMESPACE, allowBackup.namespace)
        val rules = application.androidAttribute(0x0101063e, "dataExtractionRules")!!
        assertEquals(TYPE_REFERENCE, rules.type)
        assertEquals(0x7f020001, rules.data)
        assertEquals("x".repeat(200), application.plainAttribute("note"))
        assertNull(application.androidAttribute(0x0101027f, "backupAgent"))
    }

    @Test
    fun readsBinaryXmlWithUtf8Strings() = assertManifestRead(ApkResourceReader.readXml(BinaryResourceWriter.xml(manifest, utf8 = true)))

    @Test
    fun readsBinaryXmlWithUtf16Strings() = assertManifestRead(ApkResourceReader.readXml(BinaryResourceWriter.xml(manifest, utf8 = false)))

    @Test
    fun findsAnAndroidAttributeByItsResourceIdWhateverItsName() {
        val renamed = Element("application", attributes = listOf(BinaryResourceWriter.android("a", 0x01010280, TYPE_INT_BOOLEAN, -1)))
        assertEquals(-1, ApkResourceReader.readXml(BinaryResourceWriter.xml(renamed)).androidAttribute(0x01010280, "allowBackup")!!.data)
    }

    private val entries = listOf(
        Entry(0, "other", TYPE_STRING, string = "res/other.xml"),
        Entry(1, "data_extraction_rules", TYPE_STRING, string = "res/Ab.xml"),
    )
    private val v35 = listOf(Entry(1, "data_extraction_rules", TYPE_STRING, string = "res/Cd.xml"))

    @Test
    fun readsEveryConfigurationOfAResourceInEveryTableLayout() {
        for (offsets in Offsets.entries) {
            for (compact in listOf(false, true)) {
                for (utf8 in listOf(true, false)) {
                    val table = BinaryResourceWriter.table(listOf(entries, v35), offsets = offsets, compact = compact, utf8 = utf8)
                    val values = ApkResourceReader.resourceValues(table, 0x7f020001)
                    val layout = "$offsets, compact $compact, utf8 $utf8"
                    assertEquals(layout, listOf("res/Ab.xml", "res/Cd.xml"), values.map { it.string })
                    assertEquals(layout, listOf("data_extraction_rules", "data_extraction_rules"), values.map { it.name })
                    assertEquals(layout, listOf("res/other.xml"), ApkResourceReader.resourceValues(table, 0x7f020000).map { it.string })
                }
            }
        }
    }

    @Test
    fun aResourceThatNoConfigurationHoldsHasNoValues() {
        for (offsets in Offsets.entries) {
            val table = BinaryResourceWriter.table(listOf(entries), offsets = offsets)
            assertEquals(emptyList<String>(), ApkResourceReader.resourceValues(table, 0x7f020005).map { it.string })
            assertEquals(emptyList<String>(), ApkResourceReader.resourceValues(table, 0x7f030001).map { it.string })
        }
    }

    @Test
    fun anotherPackageIsRefused() {
        val table = BinaryResourceWriter.table(listOf(entries))
        assertRefused { ApkResourceReader.resourceValues(table, 0x01020001) }
    }

    @Test
    fun aCutOffOrWrongFileIsRefused() {
        val xml = BinaryResourceWriter.xml(manifest)
        val table = BinaryResourceWriter.table(listOf(entries))
        assertRefused { ApkResourceReader.readXml(xml.copyOf(xml.size - 12)) }
        assertRefused { ApkResourceReader.readXml(xml.copyOf(6)) }
        assertRefused { ApkResourceReader.readXml(table) }
        assertRefused { ApkResourceReader.resourceValues(xml, 0x7f020001) }
        assertRefused { ApkResourceReader.resourceValues(table.copyOf(table.size - 40), 0x7f020001) }
        assertRefused { ApkResourceReader.readXml(ByteArray(64)) }
    }

    private fun assertRefused(read: () -> Unit) {
        val failure = try {
            read()
            null
        } catch (refused: RuntimeException) {
            refused
        }
        assertTrue("the reader must refuse this input", failure != null)
    }
}
