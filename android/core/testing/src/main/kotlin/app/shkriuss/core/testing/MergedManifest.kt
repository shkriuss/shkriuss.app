package app.shkriuss.core.testing

import java.io.File
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/**
 * The merged manifest of the app whose unit tests run now: the manifest
 * of the app and of every library it uses, as it goes into the APK. The
 * unit-test convention plugin of build-logic names the file in the system
 * property [PROPERTY], for app modules only.
 *
 * Robolectric's own package manager is no substitute: it also lists the
 * screens of the test libraries, which never reach the APK.
 */
object MergedManifest {
    /** Set by `MergedManifestArgument` in build-logic. */
    const val PROPERTY: String = "shkriuss.mergedManifest"

    /** The `android:name` of every `<activity>` of the app's merged manifest. */
    fun activities(): List<String> {
        val path = System.getProperty(PROPERTY)
            ?: throw AssertionError("The system property $PROPERTY is not set. The build sets it for the unit tests of an app module only.")
        return activitiesOf(File(path))
    }

    /** The `android:name` of every `<activity>` in [manifest]. The manifest merger writes the names in full. */
    fun activitiesOf(manifest: File): List<String> {
        val factory = DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = true
            setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
            setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        }
        val activities = factory.newDocumentBuilder().parse(manifest).getElementsByTagName("activity")
        return List(activities.length) { (activities.item(it) as Element).getAttributeNS(ANDROID_NAMESPACE, "name") }
    }

    private const val ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android"
}
