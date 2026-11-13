package app.shkriuss.core.security

import java.io.File
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Test
import org.w3c.dom.Element

/**
 * What this module's manifest adds to every app that uses it, as
 * docs/security/permissions.md says: two permissions, and six screens
 * that no other app can open.
 *
 * Without `HIDE_OVERLAY_WINDOWS` the screens would still work, but no
 * longer hide other apps' windows (`hideOtherAppsWindows`). This test makes
 * sure the module asks for it. Each app's merged manifest is checked by
 * the APK rules check from step 2.5 on (security-screens.md, "Open").
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

    private fun elements(tag: String): List<Element> =
        manifest.getElementsByTagName(tag).let { nodes -> List(nodes.length) { nodes.item(it) as Element } }

    private fun Element.android(name: String): String = getAttributeNS(ANDROID, name)

    @Test
    fun theModuleAsksForTheSystemPromptAndToHideOtherAppsWindowsAndNothingElse() {
        assertEquals(
            listOf("android.permission.USE_BIOMETRIC", "android.permission.HIDE_OVERLAY_WINDOWS"),
            elements("uses-permission").map { it.android("name") },
        )
        // No limit to some Android versions, and nothing else on the two entries.
        elements("uses-permission").forEach { assertEquals(1, it.attributes.length) }
        val otherTags = listOf("uses-permission-sdk-23", "permission", "permission-group", "permission-tree")
        assertEquals(emptyList<String>(), otherTags.filter { elements(it).isNotEmpty() })
    }

    @Test
    fun theModuleAddsSixScreensThatNoOtherAppCanOpen() {
        val screens = elements("activity")
        assertEquals(
            listOf(
                SecurityActivity::class.java,
                CreateRecoveryKeyActivity::class.java,
                EnterRecoveryKeyActivity::class.java,
                ShowRecoveryKeyActivity::class.java,
                AppLockActivity::class.java,
                TurnOnAppLockActivity::class.java,
            ).map { it.name },
            screens.map { it.android("name") },
        )
        screens.forEach { screen ->
            assertEquals(screen.android("name"), "false", screen.android("exported"))
            assertEquals(screen.android("name"), 0, screen.getElementsByTagName("intent-filter").length)
        }
        listOf("activity-alias", "service", "receiver", "provider").forEach { tag -> assertEquals(tag, 0, elements(tag).size) }
    }

    private companion object {
        const val ANDROID = "http://schemas.android.com/apk/res/android"
    }
}
