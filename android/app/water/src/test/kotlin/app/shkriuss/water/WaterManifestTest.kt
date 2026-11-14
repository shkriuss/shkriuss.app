package app.shkriuss.water

import app.shkriuss.core.testing.MergedManifest
import java.io.File
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.w3c.dom.Element

/**
 * What Water's merged manifest holds until step 2.5
 * (docs/security/permissions.md, "Water"): the three permissions of
 * core/notify and no other, its three receivers, one screen, and nothing
 * else that another app can reach. The receiver of the profile installer
 * is removed (owner's decision on pull request 40).
 *
 * The APK rules check fails an APK with any permission that is not on
 * Water's allow list too. This test also checks that the screen is the
 * only exported part, so a library that adds another fails here first.
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
    fun waterHoldsTheThreePermissionsOfCoreNotifyAndNoOther() {
        val tags = listOf("uses-permission", "uses-permission-sdk-23", "permission", "permission-group", "permission-tree")
        assertEquals(
            listOf(
                "<uses-permission> android.permission.POST_NOTIFICATIONS",
                "<uses-permission> android.permission.USE_EXACT_ALARM",
                "<uses-permission> android.permission.RECEIVE_BOOT_COMPLETED",
            ).sorted(),
            tags.flatMap { tag -> elements(tag).map { "<$tag> ${it.android("name")}" } }.sorted(),
        )
    }

    @Test
    fun theTwoPermissionsOfCoreSecurityStayRemovedUntilStep25() {
        val names = elements("uses-permission").map { it.android("name") }
        assertFalse("android.permission.USE_BIOMETRIC" in names)
        assertFalse("android.permission.HIDE_OVERLAY_WINDOWS" in names)
    }

    @Test
    fun theReceiversAreTheThreeOfCoreNotifyAndNoneIsExported() {
        val receivers = elements("receiver")
        assertEquals(
            setOf(
                "app.shkriuss.core.notify.AlarmReceiver",
                "app.shkriuss.core.notify.SystemEventReceiver",
                "app.shkriuss.core.notify.ButtonReceiver",
            ),
            receivers.map { it.android("name") }.toSet(),
        )
        receivers.forEach { assertEquals(it.android("name"), "false", it.android("exported")) }
    }

    @Test
    fun waterHasOneScreenAndNoneOfCoreSecurityUntilStep25() {
        assertEquals(listOf(WaterActivity::class.java.name), elements("activity").map { it.android("name") })
        val launcher = elements("activity").single().getElementsByTagName("category").item(0) as Element
        assertEquals("android.intent.category.LAUNCHER", launcher.android("name"))
    }

    @Test
    fun theScreenIsTheOnlyExportedPart() {
        val exported = listOf("activity", "activity-alias", "service", "receiver", "provider").flatMap(::elements)
            .filter { it.android("exported") == "true" }
            .map { it.android("name") }
        assertEquals(listOf(WaterActivity::class.java.name), exported)
    }

    @Test
    fun theReceiverOfTheProfileInstallerIsRemoved() {
        val receivers = elements("receiver").map { it.android("name") }
        assertFalse(receivers.toString(), "androidx.profileinstaller.ProfileInstallReceiver" in receivers)
    }

    private companion object {
        const val ANDROID = "http://schemas.android.com/apk/res/android"
    }
}
