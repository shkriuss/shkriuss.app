package app.shkriuss.water

import org.junit.rules.ExternalResource
import org.junit.rules.TestRule
import org.robolectric.RuntimeEnvironment

/**
 * One of the eight standard screenshot configurations: phone or tablet,
 * light or dark, font scale 1.0 or 2.0 (CLAUDE.md, UI and accessibility).
 *
 * A copy of Catalog's. Moving both to `core/testing` is left for later.
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
        /** All eight configurations, in a fixed order. */
        fun all(): List<ScreenshotConfig> =
            Device.entries.flatMap { device ->
                listOf(false, true).flatMap { dark ->
                    listOf(1.0f, 2.0f).map { fontScale -> ScreenshotConfig(device, dark, fontScale) }
                }
            }
    }
}
