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
 * What Water's merged manifest holds (docs/security/permissions.md,
 * "Water"): six permissions and no other, the three of core/notify and
 * the three of core/security, and the one permission it defines, the
 * handover permission of core/security; the three receivers of
 * core/notify; Water's one screen and the eight screens of core/security;
 * and nothing that another app can reach but Water's own screen and the
 * two parts of the handover between apps, which need the handover
 * permission (ADR 0041). The receiver of the profile installer is
 * removed.
 *
 * The APK rules check fails an APK with any permission that is not on
 * Water's allow list too. This test also checks which parts are exported,
 * so a library that adds another fails here first.
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
    fun waterHoldsTheThreePermissionsOfCoreNotifyTheThreeOfCoreSecurityAndDefinesOnlyTheHandoverPermission() {
        val tags = listOf("uses-permission", "uses-permission-sdk-23", "permission", "permission-group", "permission-tree")
        assertEquals(
            listOf(
                "<uses-permission> android.permission.POST_NOTIFICATIONS",
                "<uses-permission> android.permission.USE_EXACT_ALARM",
                "<uses-permission> android.permission.RECEIVE_BOOT_COMPLETED",
                "<uses-permission> android.permission.USE_BIOMETRIC",
                "<uses-permission> android.permission.HIDE_OVERLAY_WINDOWS",
                "<uses-permission> $HANDOVER",
                "<permission> $HANDOVER",
            ).sorted(),
            tags.flatMap { tag -> elements(tag).map { "<$tag> ${it.android("name")}" } }.sorted(),
        )
        assertEquals("only apps signed with the suite's key get it", "signature", elements("permission").single().android("protectionLevel"))
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
    fun waterHasItsOwnScreenAndTheEightOfCoreSecurity() {
        val screens = elements("activity")
        assertEquals((SECURITY_SCREENS + WaterActivity::class.java.name).toSet(), screens.map { it.android("name") }.toSet())
        assertEquals("each screen once", SECURITY_SCREENS.size + 1, screens.size)
        val own = screens.single { it.android("name") == WaterActivity::class.java.name }
        val launcher = own.getElementsByTagName("category").item(0) as Element
        assertEquals("android.intent.category.LAUNCHER", launcher.android("name"))
    }

    @Test
    fun noScreenOfCoreSecurityButTheHandoverScreenIsExportedOrStartsFromOutside() {
        elements("activity").filter { it.android("name") in SECURITY_SCREENS && it.android("name") != HANDOVER_SCREEN }.forEach { screen ->
            assertEquals(screen.android("name"), "false", screen.android("exported"))
            assertEquals("${screen.android("name")} has no intent filter", 0, screen.getElementsByTagName("intent-filter").length)
        }
    }

    @Test
    fun theScreenAndTheTwoPartsOfTheHandoverAreTheOnlyExportedParts() {
        val exported = listOf("activity", "activity-alias", "service", "receiver", "provider").flatMap(::elements)
            .filter { it.android("exported") == "true" }
        assertEquals(
            setOf(WaterActivity::class.java.name, HANDOVER_SCREEN, STATUS_PROVIDER),
            exported.map { it.android("name") }.toSet(),
        )
        assertEquals(3, exported.size)
        exported.filter { it.android("name") != WaterActivity::class.java.name }.forEach { part ->
            assertEquals(part.android("name"), HANDOVER, part.android("permission"))
        }
        val provider = elements("provider").single { it.android("name") == STATUS_PROVIDER }
        assertEquals("app.shkriuss.water.keeper", provider.android("authorities"))
    }

    @Test
    fun waterSeesOnlyTheAppsWithAHandoverScreen() {
        val actions = elements("queries").flatMap { queries ->
            queries.getElementsByTagName("action").let { nodes -> List(nodes.length) { (nodes.item(it) as Element).android("name") } }
        }
        assertEquals(listOf("app.shkriuss.action.HANDOVER"), actions)
        assertEquals(0, elements("queries").sumOf { it.getElementsByTagName("package").length })
    }

    @Test
    fun theReceiverOfTheProfileInstallerIsRemoved() {
        val receivers = elements("receiver").map { it.android("name") }
        assertFalse(receivers.toString(), "androidx.profileinstaller.ProfileInstallReceiver" in receivers)
    }

    private companion object {
        const val ANDROID = "http://schemas.android.com/apk/res/android"

        /** The handover permission of a debug build (ADR 0041). */
        const val HANDOVER = "app.shkriuss.permission.HANDOVER"

        const val HANDOVER_SCREEN = "app.shkriuss.core.security.HandoverActivity"

        const val STATUS_PROVIDER = "app.shkriuss.core.security.KeeperStatusProvider"

        /** The eight screens of core/security, written out here, so that a ninth fails this test first. */
        val SECURITY_SCREENS = listOf(
            "app.shkriuss.core.security.SecurityActivity",
            "app.shkriuss.core.security.CreateRecoveryKeyActivity",
            "app.shkriuss.core.security.EnterRecoveryKeyActivity",
            "app.shkriuss.core.security.ShowRecoveryKeyActivity",
            "app.shkriuss.core.security.AppLockActivity",
            "app.shkriuss.core.security.TurnOnAppLockActivity",
            HANDOVER_SCREEN,
            "app.shkriuss.core.security.GetKeysActivity",
        )
    }
}
