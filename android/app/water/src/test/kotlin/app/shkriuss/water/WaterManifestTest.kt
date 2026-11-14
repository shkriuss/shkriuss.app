package app.shkriuss.water

import app.shkriuss.core.testing.MergedManifest
import java.io.File
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Test
import org.w3c.dom.Element

/**
 * What Water's merged manifest holds until steps 2.4 and 2.5
 * (docs/security/permissions.md, "Water"): no permission at all, one
 * screen, and nothing else that another app can reach but the receiver of
 * the profile installer, which only the system and the developer shell
 * can call.
 *
 * The APK rules check fails an APK with any permission too. This test also
 * names every exported part, so a library that adds one fails here first.
 */
class WaterManifestTest {
    private val manifest: Element = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = true
        setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
        setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
    }.newDocumentBuilder().parse(File(System.getProperty(MergedManifest.PROPERTY)!!)).documentElement

    private fun elements(tag: String): List<Element> =
        manifest.getElementsByTagName(tag).let { nodes -> List(nodes.length) { nodes.item(it) as Element } }

    private fun Element.android(name: String): String = getAttributeNS(ANDROID, name)

    @Test
    fun waterHoldsNoPermission() {
        val tags = listOf("uses-permission", "uses-permission-sdk-23", "permission", "permission-group", "permission-tree")
        assertEquals(emptyList<String>(), tags.flatMap { tag -> elements(tag).map { "<$tag> ${it.android("name")}" } })
    }

    @Test
    fun waterHasOneScreenAndNoneOfCoreSecurityUntilStep25() {
        assertEquals(listOf(WaterActivity::class.java.name), elements("activity").map { it.android("name") })
        val launcher = elements("activity").single().getElementsByTagName("category").item(0) as Element
        assertEquals("android.intent.category.LAUNCHER", launcher.android("name"))
    }

    @Test
    fun onlyTheScreenAndTheProfileInstallerAreExported() {
        val exported = listOf("activity", "activity-alias", "service", "receiver", "provider").flatMap(::elements)
            .filter { it.android("exported") == "true" }
            .map { it.android("name") to it.android("permission") }
        assertEquals(
            listOf(
                WaterActivity::class.java.name to "",
                "androidx.profileinstaller.ProfileInstallReceiver" to "android.permission.DUMP",
            ),
            exported,
        )
    }

    private companion object {
        const val ANDROID = "http://schemas.android.com/apk/res/android"
    }
}
