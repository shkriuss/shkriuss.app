package app.shkriuss.core.notify

import java.io.File
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.w3c.dom.Element

/**
 * What this module's manifest adds to every app that uses it, as
 * docs/security/permissions.md says: two receivers that no other app can
 * reach and that never run before the first unlock, and no permission.
 *
 * The test reads `src/main/AndroidManifest.xml` itself. `NotifyTest`
 * shows that Android finds the receivers through it.
 */
class ManifestTest {
    /** The folder `android/`, found from wherever Gradle runs the test. */
    private val androidFolder: File = generateSequence(File("").absoluteFile) { it.parentFile }
        .first { File(it, "settings.gradle.kts").isFile && File(it, "build-logic").isDirectory }

    private val manifest: Element = DocumentBuilderFactory.newInstance().apply {
        isNamespaceAware = true
        setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
    }.newDocumentBuilder().parse(File(androidFolder, "core/notify/src/main/AndroidManifest.xml")).documentElement

    private fun elements(tag: String): List<Element> =
        manifest.getElementsByTagName(tag).let { nodes -> List(nodes.length) { nodes.item(it) as Element } }

    private fun Element.android(name: String): String = getAttributeNS(ANDROID, name)

    private val receivers = elements("receiver").associateBy { it.android("name") }

    @Test
    fun theModuleDeclaresNoPermission() {
        val tags = listOf("uses-permission", "uses-permission-sdk-23", "permission", "permission-group", "permission-tree")

        assertEquals(emptyList<String>(), tags.filter { elements(it).isNotEmpty() })
    }

    @Test
    fun theModuleAddsTwoReceiversAndNothingElse() {
        assertEquals(setOf(AlarmReceiver::class.java.name, SystemEventReceiver::class.java.name), receivers.keys)
        listOf("activity", "activity-alias", "service", "provider", "uses-library", "meta-data", "queries").forEach { tag ->
            assertEquals(tag, 0, elements(tag).size)
        }
    }

    @Test
    fun noOtherAppCanReachTheReceivers() {
        receivers.forEach { (name, receiver) -> assertEquals(name, "false", receiver.android("exported")) }
    }

    @Test
    fun nothingRunsBeforeTheFirstUnlock() {
        (receivers.values + elements("application")).forEach { element ->
            assertFalse(element.tagName, element.hasAttributeNS(ANDROID, "directBootAware"))
        }
        val actions = elements("action").map { it.android("name") }
        assertFalse("android.intent.action.LOCKED_BOOT_COMPLETED" in actions)
    }

    @Test
    fun theSystemReceiverListensForExactlyTheEventsItHandles() {
        val listed = receivers.getValue(SystemEventReceiver::class.java.name).getElementsByTagName("action")
        val actions = List(listed.length) { (listed.item(it) as Element).android("name") }

        assertEquals(SystemEventReceiver.EVENTS, actions.toSet())
        assertEquals(
            setOf(
                "android.intent.action.BOOT_COMPLETED",
                "android.intent.action.MY_PACKAGE_REPLACED",
                "android.intent.action.TIME_SET",
                "android.intent.action.TIMEZONE_CHANGED",
            ),
            actions.toSet(),
        )
        assertEquals(4, actions.size)
    }

    @Test
    fun theAlarmReceiverListensForNoBroadcastOfAnotherSender() {
        assertEquals(0, receivers.getValue(AlarmReceiver::class.java.name).getElementsByTagName("intent-filter").length)
    }

    private companion object {
        const val ANDROID = "http://schemas.android.com/apk/res/android"
    }
}
