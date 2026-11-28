package app.shkriuss.core.security

import android.content.Context
import app.shkriuss.core.crypto.AppName

/**
 * A data app of the suite on this phone, as the Sync app finds it for the
 * courier interface (docs/architecture/sync-protocol.md, "No permission of
 * our own", points 4 and 5). Its [name] comes from Android's package name,
 * never from an answer. Nothing here is secret.
 */
data class CourierApp(
    /** Its application ID, for example `app.shkriuss.water`. */
    val packageName: String,
    /** Its name, as Android shows it. */
    val label: String,
    /** Its app name, which holds data keys. */
    val name: AppName,
)

/** The data apps that the Sync app finds on this phone. */
data class CourierApps(
    /** The apps that passed the check of ADR 0041, point 9: the Sync app calls their courier. */
    val passed: List<CourierApp>,
    /**
     * The apps that fail only the comparison of certificates: one of the
     * two apps is on another signing key, or not up to date. The Sync app
     * lists them with "Update both apps" and never calls them.
     */
    val signedOtherwise: List<CourierApp>,
)

/**
 * The data apps on this phone for the Sync app's courier calls: every app
 * with a handover screen, checked as the handover checks its peers. Call it
 * on a background thread: it asks the package manager for each app.
 */
fun courierApps(context: Context): CourierApps = AndroidSuiteApps(context).courierApps()

/**
 * The app name of [callingPackage] if it may call the Sync app's own
 * courier provider: a data app of the suite, of the same build kind, signed
 * now with exactly this app's certificate. Null for every other caller,
 * which then gets no answer.
 */
fun courierPeer(context: Context, callingPackage: String?): AppName? =
    callingPackage?.let { AndroidSuiteApps(context).peerName(it) }
