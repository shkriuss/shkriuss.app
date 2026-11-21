package app.shkriuss.core.security

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.BlobAnswer
import app.shkriuss.core.crypto.BlobException
import app.shkriuss.core.crypto.HandedOverKeys

/** What a keeper's handover screen was asked, as the keeper reads it (ADR 0041, points 2 and 9). */
internal sealed interface HandoverRequest {
    /** A request it may answer: from [askerPackage], whose app name is [asker], for [mode]. */
    class Valid(val asker: AppName, val askerPackage: String, val mode: HandoverMode) : HandoverRequest

    /** A request of a newer version than this app knows. */
    data object Newer : HandoverRequest

    /** Anything else. The screen shows nothing and gives nothing. */
    data object Refused : HandoverRequest

    companion object {
        /**
         * Reads a request. [callingPackage] is the app Android names as the
         * receiver of the result; nothing in [extras] names the asker.
         */
        fun of(callingPackage: String?, extras: Bundle?, suite: SuiteApps): HandoverRequest {
            val caller = callingPackage ?: return Refused
            val asker = suite.peerName(caller) ?: return Refused
            val (version, mode) = try {
                (extras?.getInt(Handover.EXTRA_VERSION, 0) ?: 0) to extras?.getString(Handover.EXTRA_MODE)
            } catch (_: RuntimeException) {
                return Refused
            }
            if (version > Handover.VERSION) return Newer
            if (version != Handover.VERSION) return Refused
            val known = HandoverMode.entries.firstOrNull { it.name == mode } ?: return Refused
            return Valid(asker, caller, known)
        }
    }
}

/** The result a keeper's handover screen gives when it gives no keys: [refusal], or none when the user did not allow it. */
internal fun refusalResult(refusal: HandoverRefusal?): Intent? = refusal?.let { Intent().putExtra(Handover.EXTRA_REFUSAL, it.name) }

/**
 * Why the keeper's handover screen gives no keys when the user taps
 * **Close** on [screen] (ADR 0041, point 16): `NOT_KEEPER` when it keeps
 * no key now, also when the kept copy turned out damaged, so that the
 * asking app offers the 24 words. None otherwise: the asking app changes
 * nothing.
 */
internal fun closingRefusal(screen: HandoverScreen): HandoverRefusal? = when (screen) {
    HandoverNotKept -> HandoverRefusal.NOT_KEEPER
    is HandoverFailed -> if (screen.damaged) HandoverRefusal.NOT_KEEPER else null
    else -> null
}

/** The result a keeper's handover screen gives with the keys. Never shown or logged: a bundle's text lists its bytes. */
internal fun keysResult(keys: HandedOverKeys): Intent = Intent().putExtras(Bundle().also { keys.writeTo(it) })

/**
 * The result of a keeper's handover screen once [keys] are made for
 * [request]: the caller is checked once more (ADR 0041, point 9). It must
 * still be the app that asked, and still pass. Otherwise it gets a
 * cancelled result that says `REFUSED`, and no keys.
 */
internal fun handoverResult(caller: String?, request: HandoverRequest.Valid, suite: SuiteApps, keys: HandedOverKeys): Pair<Int, Intent?> =
    if (caller == null || caller != request.askerPackage || suite.peerName(caller) != request.asker) {
        Activity.RESULT_CANCELED to refusalResult(HandoverRefusal.REFUSED)
    } else {
        Activity.RESULT_OK to keysResult(keys)
    }

/** What came back from a keeper's handover screen, as the asking app reads it. */
internal sealed interface KeeperAnswer {
    /** The keys, read and checked by `core/crypto`. */
    class Keys(val keys: HandedOverKeys) : KeeperAnswer

    /** The user did not allow it, or left the keeper's screen. Nothing changes. */
    data object Declined : KeeperAnswer

    /** The keeper does not keep the recovery key now. */
    data object NotKeeper : KeeperAnswer

    /** One of the two apps is older than the other. */
    data object Update : KeeperAnswer

    /** The keeper sent something this app cannot read. */
    data object Unreadable : KeeperAnswer

    /**
     * The app is not, or no longer, an app of the suite this app may take
     * keys from, or it refused this app (`REFUSED`): one of the two is
     * signed otherwise, or not up to date.
     */
    data object NotASuiteApp : KeeperAnswer

    companion object {
        /**
         * Reads what [keeper] answered. The keeper is checked again first:
         * the app that answered must still be one this app may take keys
         * from.
         */
        fun of(keeper: String, result: ActivityResult, suite: SuiteApps): KeeperAnswer {
            if (suite.peerName(keeper) == null) return NotASuiteApp
            val extras = try {
                result.data?.extras
            } catch (_: RuntimeException) {
                return Unreadable
            }
            if (result.resultCode == Activity.RESULT_OK) {
                if (extras == null) return Unreadable
                return try {
                    Keys(HandedOverKeys.readFrom(extras))
                } catch (failed: BlobException) {
                    if (failed.answer == BlobAnswer.MADE_BY_A_NEWER_VERSION) Update else Unreadable
                }
            }
            val refusal = try {
                extras?.getString(Handover.EXTRA_REFUSAL)
            } catch (_: RuntimeException) {
                null
            }
            return when (refusal) {
                HandoverRefusal.NOT_KEEPER.name -> NotKeeper
                HandoverRefusal.UPDATE.name -> Update
                HandoverRefusal.REFUSED.name -> NotASuiteApp
                else -> Declined
            }
        }
    }
}

/**
 * Opens a keeper's handover screen and reads its answer, for the screens
 * of the asking app. Made in the screen's `onCreate`, after
 * `super.onCreate`. [keeper] says which app to ask; [onAnswer] gets the
 * app that was asked and its answer.
 *
 * The answer may hold keys, so it must never wait in the screen's saved
 * state (ADR 0041, point 20). A callback registered with a lifecycle gets
 * a result only while the screen is started; one that comes earlier, say
 * while the keeper's screen still covers this one, waits as a pending
 * result, and AndroidX saves pending results with the screen's state.
 * So the callback is registered with no lifecycle: Android hands it the
 * answer at once, whatever the screen's state, from `onCreate` until the
 * screen is destroyed.
 *
 * Android may end this app's process while the keeper's screen is in
 * front, and make this screen anew when the answer comes. So the saved
 * state holds the application ID of the app that was asked, which is not
 * secret, and nothing else: the answer still reaches [onAnswer] with it.
 */
internal class KeeperCall(
    activity: ComponentActivity,
    private val suite: SuiteApps,
    private val keeper: () -> String?,
    private val onAnswer: (keeper: String, answer: KeeperAnswer) -> Unit,
) {
    /** The app asked last, until it answers. */
    private var asked: String? = activity.savedStateRegistry.consumeRestoredStateForKey(STATE_KEY)?.getString(ASKED)

    private val launcher = activity.activityResultRegistry.register(
        REGISTRY_KEY,
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val packageName = asked ?: return@register
        asked = null
        onAnswer(packageName, KeeperAnswer.of(packageName, result, suite))
    }

    init {
        activity.savedStateRegistry.registerSavedStateProvider(STATE_KEY) {
            Bundle().apply { asked?.let { putString(ASKED, it) } }
        }
        activity.lifecycle.addObserver(
            LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_DESTROY) launcher.unregister() },
        )
    }

    internal companion object {
        /** The one name of the answer in the screen's result registry. A screen asks one keeper at a time. */
        const val REGISTRY_KEY = "app.shkriuss.security.KeeperCall"

        /** Where the screen's saved state holds the app that was asked. */
        const val STATE_KEY = "app.shkriuss.security.KeeperCall.state"

        private const val ASKED = "asked"
    }

    /** Opens the keeper's handover screen for [mode], after checking the keeper. A keeper that fails is answered at once. */
    fun ask(mode: HandoverMode) {
        val packageName = keeper() ?: return
        val intent = if (suite.peerName(packageName) != null) suite.handoverIntent(packageName, mode) else null
        if (intent == null) {
            onAnswer(packageName, KeeperAnswer.NotASuiteApp)
            return
        }
        asked = packageName
        try {
            launcher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            asked = null
            onAnswer(packageName, KeeperAnswer.NotASuiteApp)
        } catch (_: SecurityException) {
            // Android refused to start it: the keeper's screen is not open to this app.
            asked = null
            onAnswer(packageName, KeeperAnswer.NotASuiteApp)
        }
    }
}
