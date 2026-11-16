package app.shkriuss.catalog

import org.junit.rules.ExternalResource
import org.junit.rules.TestRule
import org.robolectric.RuntimeEnvironment

/**
 * One of the four standard screenshot configurations: phone light at font
 * scale 1.0, phone dark at 2.0, tablet light at 2.0 and tablet dark at 1.0
 * (CLAUDE.md, UI and accessibility).
 *
 * Water's tests have a copy. Moving it to `core/testing` is open
 * (docs/development/design-system.md, "Open").
 */
data class ScreenshotConfig(
    val device: Device,
    val dark: Boolean,
    val fontScale: Float,
) {
    /** The part of the image file name that names this configuration. */
    val name: String
        get() = "${device.label}_${if (dark) "dark" else "light"}_font${fontScale}"

    /**
     * The Robolectric qualifiers for this configuration, as one string in
     * Android's qualifier order. Night mode sits between the orientation
     * and the density.
     */
    val qualifiers: String
        get() = "${device.screen}-${if (dark) "night" else "notnight"}-${device.density}-keyshidden-nonav"

    /**
     * A test rule that sets up Robolectric's screen. Put it outside the
     * Compose rule, so the screen is ready before the activity starts.
     */
    fun rule(): TestRule = object : ExternalResource() {
        override fun before() {
            RuntimeEnvironment.setQualifiers(qualifiers)
            RuntimeEnvironment.setFontScale(fontScale)
        }
    }

    override fun toString(): String = name

    /** The two screen sizes every screen is checked at. */
    enum class Device(val label: String, val screen: String, val density: String) {
        /** 411 by 914 dp at 420 dpi, close to the Pixel 9 Pro. */
        Phone("phone", "w411dp-h914dp-normal-long-notround-port", "420dpi"),

        /** 1280 by 800 dp at 320 dpi in landscape, the Pixel Tablet. */
        Tablet("tablet", "w1280dp-h800dp-xlarge-long-notround-land", "xhdpi"),
    }

    companion object {
        /**
         * The four configurations, in a fixed order. Each device, theme and
         * font scale is in two of them, and each pair of them in one, so
         * only a fault that needs one exact device, theme and font scale
         * together can pass unseen.
         */
        fun all(): List<ScreenshotConfig> =
            listOf(
                ScreenshotConfig(Device.Phone, dark = false, fontScale = 1.0f),
                ScreenshotConfig(Device.Phone, dark = true, fontScale = 2.0f),
                ScreenshotConfig(Device.Tablet, dark = false, fontScale = 2.0f),
                ScreenshotConfig(Device.Tablet, dark = true, fontScale = 1.0f),
            )
    }
}
