package app.shkriuss.sync

import app.shkriuss.core.testing.MergedManifest
import java.io.File
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Test
import org.w3c.dom.Element

/**
 * What Sync's merged manifest holds (docs/security/permissions.md,
 * "Sync"): the network and the two permissions JobScheduler needs, and no
 * other, and none that it defines; no receiver; Sync's one screen and none
 * of core/security's; and nothing that another app can reach but that
 * screen, Sync's courier provider, which checks its caller itself, and
 * the job service, which only Android can bind.
 *
 * The APK rules check fails an APK with any permission that is not on
 * Sync's allow list too. This test also checks which parts are exported,
 * so a library that adds another fails here first.
 */
class SyncManifestTest {
    private val manifest: Element = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = true
        setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
        setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
    }.newDocumentBuilder().parse(File(System.getProperty(MergedManifest.PROPERTY)!!)).documentElement

    private fun elements(tag: String): List<Element> =
        manifest.getElementsByTagName(tag).let { nodes -> List(nodes.length) { nodes.item(it) as Element } }

    private fun Element.android(name: String): String = getAttributeNS(ANDROID, name)

    @Test
    fun syncHoldsTheNetworkAndTheTwoThatJobSchedulerNeedsAndNoOther() {
        val tags = listOf("uses-permission", "uses-permission-sdk-23", "permission", "permission-group", "permission-tree")
        assertEquals(
            listOf(
                "<uses-permission> android.permission.INTERNET",
                "<uses-permission> android.permission.ACCESS_NETWORK_STATE",
                "<uses-permission> android.permission.RECEIVE_BOOT_COMPLETED",
            ).sorted(),
            tags.flatMap { tag -> elements(tag).map { "<$tag> ${it.android("name")}" } }.sorted(),
        )
    }

    @Test
    fun syncHasNoReceiverAndOnlyItsOwnScreen() {
        // The receiver of the profile installer is removed.
        assertEquals(emptyList<String>(), elements("receiver").map { it.android("name") })
        val screens = elements("activity")
        assertEquals(listOf(SyncActivity::class.java.name), screens.map { it.android("name") })
        val launcher = screens.single().getElementsByTagName("category").item(0) as Element
        assertEquals("android.intent.category.LAUNCHER", launcher.android("name"))
    }

    @Test
    fun theScreenTheCourierProviderAndTheJobServiceAreTheOnlyExportedParts() {
        val exported = listOf("activity", "activity-alias", "service", "receiver", "provider").flatMap(::elements)
            .filter { it.android("exported") == "true" }
        assertEquals(setOf(SyncActivity::class.java.name, COURIER_PROVIDER, JOB_SERVICE), exported.map { it.android("name") }.toSet())
        assertEquals(3, exported.size)

        val provider = elements("provider").single { it.android("name") == COURIER_PROVIDER }
        assertEquals("app.shkriuss.sync.courier", provider.android("authorities"))
        listOf("permission", "readPermission", "writePermission", "grantUriPermissions").forEach {
            assertEquals("$it: its own check is the gate", "", provider.android(it))
        }
        val service = elements("service").single { it.android("name") == JOB_SERVICE }
        assertEquals("only Android can bind it", "android.permission.BIND_JOB_SERVICE", service.android("permission"))
        assertEquals("no other service", listOf(JOB_SERVICE), elements("service").map { it.android("name") })
        assertEquals(
            "no provider of core/security",
            setOf(COURIER_PROVIDER, "androidx.startup.InitializationProvider"),
            elements("provider").map { it.android("name") }.toSet(),
        )
    }

    @Test
    fun syncSeesOnlyTheAppsWithAHandoverScreen() {
        val actions = elements("queries").flatMap { queries ->
            queries.getElementsByTagName("action").let { nodes -> List(nodes.length) { (nodes.item(it) as Element).android("name") } }
        }
        assertEquals(listOf("app.shkriuss.action.HANDOVER"), actions)
        assertEquals(0, elements("queries").sumOf { it.getElementsByTagName("package").length })
    }

    @Test
    fun androidBackupAndCleartextAreOffAndTheNetworkConfigurationIsSet() {
        val application = elements("application").single()
        assertEquals("false", application.android("allowBackup"))
        assertEquals("false", application.android("usesCleartextTraffic"))
        assertEquals("@xml/network_security_config", application.android("networkSecurityConfig"))
    }

    private companion object {
        const val ANDROID = "http://schemas.android.com/apk/res/android"
        const val COURIER_PROVIDER = "app.shkriuss.feature.sync.SyncCourierProvider"
        const val JOB_SERVICE = "app.shkriuss.feature.sync.SyncJobService"
    }
}
