package app.shkriuss.feature.water

import android.app.Activity
import app.shkriuss.core.data.Clock
import app.shkriuss.core.data.IdSource
import app.shkriuss.feature.water.data.WaterDatabase
import java.time.ZoneId

/**
 * Everything of Water that lives as long as the app: its database, the
 * repository on it, and the phone's local time. The app class builds one
 * and hands it out through [WaterHost]. Nothing here is found by a lookup:
 * the ViewModels get what they need through their constructors.
 */
class WaterServices(
    /** The app's one database. */
    val database: WaterDatabase,
    clock: Clock,
    ids: IdSource,
    zone: () -> ZoneId = ZoneId::systemDefault,
) {
    /** The phone's local day and time. */
    val time: WaterTime = WaterTime(clock, zone)

    /** The drinks, the goals and the settings. */
    val repository: WaterRepository = WaterRepository(database, clock, ids)
}

/**
 * The app class of Water. Android creates the screens itself, so they reach
 * [WaterServices] through the app class, as the screens of `core/security`
 * reach its `SecurityHost`.
 */
interface WaterHost {
    /** The app's one [WaterServices]. */
    val water: WaterServices
}

/** The [WaterServices] of the app this screen belongs to. */
val Activity.waterServices: WaterServices
    get() = (application as? WaterHost ?: error("The app class must implement WaterHost")).water
