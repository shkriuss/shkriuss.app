package app.shkriuss.core.design

import android.content.ComponentName
import androidx.activity.ComponentActivity
import org.junit.rules.ExternalResource
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

/**
 * Sets the font scale, and lets Robolectric start a plain
 * [ComponentActivity], which no manifest of this library declares. Put it
 * outside the Compose rule, so both are ready before the activity starts.
 */
internal class TestActivitySetUp(private val fontScale: Float) : ExternalResource() {
    override fun before() {
        RuntimeEnvironment.setFontScale(fontScale)
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app.packageManager).addActivityIfNotPresent(ComponentName(app, ComponentActivity::class.java))
    }
}
