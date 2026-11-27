package app.shkriuss.core.security

import android.content.Context
import androidx.activity.ComponentActivity
import app.shkriuss.core.crypto.DeviceJoinRequest
import app.shkriuss.core.crypto.SignedJoin

/**
 * What a data app answered when the Sync app asked it to sign that this
 * phone may join a sync server (Sync's specification, join step 6).
 */
sealed interface SignDeviceAnswer {
    /** The signed join and the name key, read and checked by `core/crypto`. */
    class Signed(val signed: SignedJoin) : SignDeviceAnswer {
        override fun toString(): String = "Signed"
    }

    /** The user did not allow it, or left the data app's screen. Nothing changes. */
    data object Declined : SignDeviceAnswer

    /** The data app does not keep the recovery key now, or has no keys (`NOT_KEEPER`). */
    data object NotKeeper : SignDeviceAnswer

    /** One of the two apps is older than the other (`UPDATE`). */
    data object Update : SignDeviceAnswer

    /** One of the two is signed otherwise, or not up to date (`REFUSED`), or the app is not a data app of the suite. */
    data object Refused : SignDeviceAnswer

    /** The data app has no keys of the recovery key the request named (`OTHER_KEY`). */
    data object OtherKey : SignDeviceAnswer

    /** The data app sent something this app cannot read. */
    data object Unreadable : SignDeviceAnswer

    companion object {
        /** The answer for the Sync app of what [KeeperCall] read. */
        internal fun of(answer: KeeperAnswer): SignDeviceAnswer = when (answer) {
            is KeeperAnswer.Signed -> Signed(answer.signed)
            KeeperAnswer.Declined -> Declined
            KeeperAnswer.NotKeeper -> NotKeeper
            KeeperAnswer.Update -> Update
            KeeperAnswer.NotASuiteApp -> Refused
            KeeperAnswer.OtherKey -> OtherKey
            KeeperAnswer.Unreadable, is KeeperAnswer.Keys -> Unreadable
        }
    }
}

/**
 * The Sync app's side of "Sign a device" (crypto-design.md, "The handover
 * format, version 2"): it opens a data app's handover screen with what is
 * to be signed and reads its answer. Made in the screen's `onCreate`,
 * after `super.onCreate`, as [KeeperCall] is, whose rules it follows: the
 * answer never waits in the screen's saved state, and after Android ended
 * the Sync app the answer still reaches [onAnswer]. [app] says which data
 * app to ask.
 */
class SignDeviceCall internal constructor(
    activity: ComponentActivity,
    suite: SuiteApps,
    app: () -> String?,
    onAnswer: (app: String, answer: SignDeviceAnswer) -> Unit,
) {
    /** The call for the screen [activity], asking the data app that [app] names. */
    constructor(activity: ComponentActivity, app: () -> String?, onAnswer: (app: String, answer: SignDeviceAnswer) -> Unit) :
        this(activity, AndroidSuiteApps(activity), app, onAnswer)

    private val call = KeeperCall(activity, suite, app) { asked, answer -> onAnswer(asked, SignDeviceAnswer.of(answer)) }

    /** True while an asked app has not answered yet, also after Android made the screen anew. */
    val waiting: Boolean get() = call.waiting

    /** Asks the data app to sign [request]. A data app that fails the check is answered at once with [SignDeviceAnswer.Refused]. */
    fun ask(request: DeviceJoinRequest) = call.ask(HandoverMode.SIGN_DEVICE, request)
}

/**
 * The data apps of the suite on this phone that have their keys from a
 * recovery key, for the Sync app's join step 6: each one that keeps the
 * key signs after the system prompt, each other one with all 24 words.
 * Each passed the check of ADR 0041, point 9. Slow: it asks each app, so
 * call it on a background thread.
 */
fun signingApps(context: Context): List<KeyApp> = AndroidSuiteApps(context).appsWithKeys()
