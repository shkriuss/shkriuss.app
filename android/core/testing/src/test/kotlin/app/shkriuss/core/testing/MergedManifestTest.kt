package app.shkriuss.core.testing

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * How [MergedManifest] reads the activities of an app's merged manifest: every
 * `<activity>`, by its full name, and nothing else. A manifest with a
 * document type is refused, as the APK rules check refuses one.
 */
class MergedManifestTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private fun manifest(text: String): File = temporary.newFile("AndroidManifest.xml").apply { writeText(text) }

    @Test
    fun everyActivityIsReadByItsFullName() {
        val file = manifest(
            """
            <manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.shkriuss.water">
                <uses-permission android:name="android.permission.USE_BIOMETRIC" />
                <application>
                    <activity android:name="app.shkriuss.water.WaterActivity" android:exported="true" />
                    <activity android:name="app.shkriuss.core.security.SecurityActivity" android:exported="false" />
                    <activity-alias android:name="app.shkriuss.water.Alias" android:targetActivity="app.shkriuss.water.WaterActivity" />
                    <receiver android:name="app.shkriuss.core.notify.AlarmReceiver" />
                </application>
            </manifest>
            """.trimIndent(),
        )
        assertEquals(
            listOf("app.shkriuss.water.WaterActivity", "app.shkriuss.core.security.SecurityActivity"),
            MergedManifest.activitiesOf(file),
        )
    }

    @Test
    fun aManifestWithADocumentTypeIsRefused() {
        val file = manifest(
            """
            <?xml version="1.0"?>
            <!DOCTYPE manifest [ <!ENTITY name "app.shkriuss.water.WaterActivity"> ]>
            <manifest xmlns:android="http://schemas.android.com/apk/res/android">
                <application><activity android:name="&name;" /></application>
            </manifest>
            """.trimIndent(),
        )
        assertThrows(Exception::class.java) { MergedManifest.activitiesOf(file) }
    }

    @Test
    fun withoutThePropertyOfTheBuildTheCheckFailsAndSaysWhy() {
        // The unit tests of a library module are not given a merged manifest of an app.
        val failure = assertThrows(AssertionError::class.java) { MergedManifest.activities() }
        assertEquals(true, failure.message.orEmpty().contains("shkriuss.mergedManifest is not set"))
    }
}
