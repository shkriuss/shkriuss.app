package app.shkriuss.core.security

import java.io.File
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Test
import org.w3c.dom.Element

/**
 * What this module's manifest adds to every app that uses it, as
 * docs/security/permissions.md says: two permissions, eight screens, and
 * one status provider. Only the handover screen and the status provider
 * are exported. The suite defines no permission for them: each checks its
 * caller itself (ADR 0041, points 6 to 8).
 *
 * Without `HIDE_OVERLAY_WINDOWS` the screens would still work, but no
 * longer hide other apps' windows (`hideOtherAppsWindows`). This test makes
 * sure the module asks for it. Each app's merged manifest is checked by
 * the APK rules check (docs/development/build.md, "APK
 * rules check", rule 10).
 *
 * The test reads `src/main/AndroidManifest.xml` itself.
 */
class ManifestTest {
    /** The folder `android/`, found from wherever Gradle runs the test. */
    private val androidFolder: File = generateSequence(File("").absoluteFile) { it.parentFile }
        .first { File(it, "settings.gradle.kts").isFile && File(it, "build-logic").isDirectory }

    private val manifest: Element = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = true
        setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
    }.newDocumentBuilder().parse(File(androidFolder, "core/security/src/main/AndroidManifest.xml")).documentElement

    private fun elements(tag: String, under: Element = manifest): List<Element> =
        under.getElementsByTagName(tag).let { nodes -> List(nodes.length) { nodes.item(it) as Element } }

    private fun Element.android(name: String): String = getAttributeNS(ANDROID, name)

    @Test
    fun theModuleAsksForTheSystemPromptAndToHideOtherAppsWindowsAndNothingElse() {
        assertEquals(
            listOf("android.permission.USE_BIOMETRIC", "android.permission.HIDE_OVERLAY_WINDOWS"),
            elements("uses-permission").map { it.android("name") },
        )
        // No limit to some Android versions, and nothing else on the entries.
        elements("uses-permission").forEach { assertEquals(1, it.attributes.length) }
    }

    @Test
    fun theModuleDefinesNoPermission() {
        val tags = listOf("permission", "permission-group", "permission-tree", "uses-permission-sdk-23")
        assertEquals(emptyList<String>(), tags.filter { elements(it).isNotEmpty() })
    }

    @Test
    fun theModuleAddsEightScreensAndOnlyTheHandoverScreenIsExported() {
        val screens = elements("activity")
        assertEquals(
            listOf(
                SecurityActivity::class.java,
                CreateRecoveryKeyActivity::class.java,
                EnterRecoveryKeyActivity::class.java,
                ShowRecoveryKeyActivity::class.java,
                AppLockActivity::class.java,
                TurnOnAppLockActivity::class.java,
                HandoverActivity::class.java,
                GetKeysActivity::class.java,
            ).map { it.name },
            screens.map { it.android("name") },
        )
        screens.filter { it.android("name") != HandoverActivity::class.java.name }.forEach { screen ->
            assertEquals(screen.android("name"), "false", screen.android("exported"))
            assertEquals(screen.android("name"), "", screen.android("permission"))
            assertEquals(screen.android("name"), 0, elements("intent-filter", screen).size)
        }
        val handover = screens.single { it.android("name") == HandoverActivity::class.java.name }
        assertEquals("true", handover.android("exported"))
        assertEquals("its own check is the gate", "", handover.android("permission"))
        val filter = elements("intent-filter", handover).single()
        assertEquals(listOf(Handover.ACTION), elements("action", filter).map { it.android("name") })
        assertEquals("no category: it opens only when it is named", 0, elements("category", filter).size)
        assertEquals(0, elements("data", filter).size)
        listOf("activity-alias", "service", "receiver").forEach { tag -> assertEquals(tag, 0, elements(tag).size) }
    }

    @Test
    fun theStatusProviderIsExportedWithNoPermission() {
        val provider = elements("provider").single()
        assertEquals(KeeperStatusProvider::class.java.name, provider.android("name"))
        assertEquals("\${applicationId}.keeper", provider.android("authorities"))
        assertEquals("true", provider.android("exported"))
        listOf("permission", "readPermission", "writePermission", "grantUriPermissions").forEach { assertEquals(it, "", provider.android(it)) }
        assertEquals(0, elements("grant-uri-permission", provider).size)
        assertEquals(0, elements("path-permission", provider).size)
    }

    @Test
    fun lintIsToldToIgnoreOneCheckOnTheStatusProviderAndNothingElse() {
        // The owner's decision (docs/development/build.md, "Lint"): the provider is exported with no permission by ADR 0041.
        val ignoring = elements("*").filter { it.hasAttributeNS(TOOLS, "ignore") }
        assertEquals(listOf(KeeperStatusProvider::class.java.name), ignoring.map { it.android("name") })
        assertEquals("ExportedContentProvider", ignoring.single().getAttributeNS(TOOLS, "ignore"))
    }

    @Test
    fun theModuleSeesOnlyTheAppsWithAHandoverScreen() {
        val queries = elements("queries").single()
        assertEquals(listOf(Handover.ACTION), elements("action", queries).map { it.android("name") })
        assertEquals(0, elements("package", queries).size)
        assertEquals(0, elements("provider", queries).size)
    }

    private companion object {
        const val ANDROID = "http://schemas.android.com/apk/res/android"
        const val TOOLS = "http://schemas.android.com/tools"
    }
}
