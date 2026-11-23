package app.shkriuss.tasks

import app.shkriuss.core.testing.MergedManifest
import java.io.File
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Test
import org.w3c.dom.Element

/**
 * What Tasks' merged manifest holds (docs/security/permissions.md,
 * "Tasks"): the two permissions of core/security and no other, and none
 * that it defines; no receiver; Tasks' one screen and the eight screens of
 * core/security; and nothing that another app can reach but Tasks' own
 * screen and the two parts of the handover between apps (ADR 0041).
 * Those two have no permission: each checks its caller itself. The
 * receiver of the profile installer is removed, as in Water.
 *
 * The APK rules check fails an APK with any permission that is not on
 * Tasks' allow list too. This test also checks which parts are exported,
 * so a library that adds another fails here first. When the reminders
 * come, with core/notify, its three permissions and three receivers join
 * this test, as in Reminders' manifest test.
 */
class TasksManifestTest {
    private val manifest: Element = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = true
        setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
        setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
    }.newDocumentBuilder().parse(File(System.getProperty(MergedManifest.PROPERTY)!!)).documentElement

    private fun elements(tag: String): List<Element> =
        manifest.getElementsByTagName(tag).let { nodes -> List(nodes.length) { nodes.item(it) as Element } }

    private fun Element.android(name: String): String = getAttributeNS(ANDROID, name)

    @Test
    fun tasksHoldsTheTwoPermissionsOfCoreSecurityAndNoOther() {
        val tags = listOf("uses-permission", "uses-permission-sdk-23", "permission", "permission-group", "permission-tree")
        assertEquals(
            listOf(
                "<uses-permission> android.permission.USE_BIOMETRIC",
                "<uses-permission> android.permission.HIDE_OVERLAY_WINDOWS",
            ).sorted(),
            tags.flatMap { tag -> elements(tag).map { "<$tag> ${it.android("name")}" } }.sorted(),
        )
    }

    @Test
    fun tasksHasNoReceiver() {
        // The receiver of the profile installer is removed.
        assertEquals(emptyList<String>(), elements("receiver").map { it.android("name") })
    }

    @Test
    fun tasksHasItsOwnScreenAndTheEightOfCoreSecurity() {
        val screens = elements("activity")
        assertEquals((SECURITY_SCREENS + TasksActivity::class.java.name).toSet(), screens.map { it.android("name") }.toSet())
        assertEquals("each screen once", SECURITY_SCREENS.size + 1, screens.size)
        val own = screens.single { it.android("name") == TasksActivity::class.java.name }
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
            setOf(TasksActivity::class.java.name, HANDOVER_SCREEN, STATUS_PROVIDER),
            exported.map { it.android("name") }.toSet(),
        )
        assertEquals(3, exported.size)
        exported.filter { it.android("name") != TasksActivity::class.java.name }.forEach { part ->
            assertEquals("${part.android("name")}: its own check is the gate", "", part.android("permission"))
        }
        val provider = elements("provider").single { it.android("name") == STATUS_PROVIDER }
        listOf("readPermission", "writePermission", "grantUriPermissions").forEach { assertEquals(it, "", provider.android(it)) }
        assertEquals("app.shkriuss.tasks.keeper", provider.android("authorities"))
    }

    @Test
    fun tasksSeesOnlyTheAppsWithAHandoverScreen() {
        val actions = elements("queries").flatMap { queries ->
            queries.getElementsByTagName("action").let { nodes -> List(nodes.length) { (nodes.item(it) as Element).android("name") } }
        }
        assertEquals(listOf("app.shkriuss.action.HANDOVER"), actions)
        assertEquals(0, elements("queries").sumOf { it.getElementsByTagName("package").length })
    }

    @Test
    fun androidBackupIsOff() {
        val application = elements("application").single()
        assertEquals("false", application.android("allowBackup"))
    }

    private companion object {
        const val ANDROID = "http://schemas.android.com/apk/res/android"

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
