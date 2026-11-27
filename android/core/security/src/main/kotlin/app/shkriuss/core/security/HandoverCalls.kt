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
import app.shkriuss.core.crypto.DeviceJoinRequest
import app.shkriuss.core.crypto.HandedOverKeys
import app.shkriuss.core.crypto.SignedJoin

/** What a keeper's handover screen was asked, as the keeper reads it (ADR 0041, points 2 and 9). */
internal sealed interface HandoverRequest {
    /**
     * A request it may answer: from [askerPackage], whose app name is
     * [asker], for [mode]. [join] is what the Sync app asks to be signed,
     * in [HandoverMode.SIGN_DEVICE] and only there.
     */
    class Valid(val asker: AppName, val askerPackage: String, val mode: HandoverMode, val join: DeviceJoinRequest? = null) : HandoverRequest

    /** A request of a newer version than this app knows. */
    data object Newer : HandoverRequest

    /** Anything else. The screen shows nothing and gives nothing. */
    data object Refused : HandoverRequest

    companion object {
        /**
         * Reads a request. [callingPackage] is the app Android names as the
         * receiver of the result; nothing in [extras] names the asker.
         *
         * Another data app may ask in the modes of version 1. The Sync app
         * may ask only in [HandoverMode.SIGN_DEVICE], which no other app
         * may ask in, and its request must carry a [DeviceJoinRequest]
         * that passes its checks. A reader of version 2 reads version 1.
         */
        fun of(callingPackage: String?, extras: Bundle?, suite: SuiteApps): HandoverRequest {
            val caller = callingPackage ?: return Refused
            val peer = suite.peerName(caller)
            val sync = peer == null && suite.isSyncApp(caller)
            if (peer == null && !sync) return Refused
            val (version, mode) = try {
                (extras?.getInt(Handover.EXTRA_VERSION, 0) ?: 0) to extras?.getString(Handover.EXTRA_MODE)
            } catch (_: RuntimeException) {
                return Refused
            }
            if (version > Handover.NEWEST_VERSION) return Newer
            if (version !in Handover.VERSION..Handover.NEWEST_VERSION) return Refused
            val known = HandoverMode.entries.firstOrNull { it.name == mode && it.version <= version } ?: return Refused
            if ((known == HandoverMode.SIGN_DEVICE) != sync) return Refused
            if (!sync) return Valid(checkNotNull(peer), caller, known)
            val join = extras?.let(DeviceJoinRequest::readFrom) ?: return Refused
            return Valid(SYNC, caller, known, join)
        }

        /** The app name of the Sync app. */
        private val SYNC = AppName.of("sync")
    }
}

/** The result a keeper's handover screen gives when it gives no keys: [refusal], or none when the user did not allow it. */
internal fun refusalResult(refusal: HandoverRefusal?): Intent? = refusal?.let { Intent().putExtra(Handover.EXTRA_REFUSAL, it.name) }

/**
 * Why the keeper's handover screen gives no keys when the user taps
 * **Close** on [screen] (ADR 0041, point 16): `NOT_KEEPER` when it keeps
 * no key now, also when the kept copy turned out damaged, so that the
 * asking app offers the 24 words. `OTHER_KEY` when it has no keys of the
 * recovery key the Sync app named. None otherwise: the asking app changes
 * nothing.
 */
internal fun closingRefusal(screen: HandoverScreen): HandoverRefusal? = when (screen) {
    HandoverNotKept -> HandoverRefusal.NOT_KEEPER
    is HandoverOtherKey -> HandoverRefusal.OTHER_KEY
    is HandoverFailed -> if (screen.damaged) HandoverRefusal.NOT_KEEPER else null
    else -> null
}

/** The result a keeper's handover screen gives with the keys. Never shown or logged: a bundle's text lists its bytes. */
internal fun keysResult(keys: HandedOverKeys): Intent = Intent().putExtras(Bundle().also { keys.writeTo(it) })

/** The result a keeper's handover screen gives with a signed join. It holds the name key, so it is never shown or logged either. */
internal fun signedResult(signed: SignedJoin): Intent = Intent().putExtras(Bundle().also { signed.writeTo(it) })

/** What a keeper's handover screen hands over: the keys of an app, or a signed join for the Sync app. */
internal sealed interface HandoverGift {
    /** The keys of [HandoverMode.KEYS] and [HandoverMode.CHECK_WORDS]. */
    class Keys(val keys: HandedOverKeys) : HandoverGift

    /** The signed join of [HandoverMode.SIGN_DEVICE]. */
    class Signed(val signed: SignedJoin) : HandoverGift
}

/**
 * The result of a keeper's handover screen once [gift] is made for
 * [request]: the caller is checked once more (ADR 0041, point 9). It must
 * still be the app that asked, and still pass: the Sync app for
 * [HandoverMode.SIGN_DEVICE], another data app for the others. Otherwise
 * it gets a cancelled result that says `REFUSED`, and nothing.
 */
internal fun handoverResult(caller: String?, request: HandoverRequest.Valid, suite: SuiteApps, gift: HandoverGift): Pair<Int, Intent?> {
    val stillPasses = caller != null && caller == request.askerPackage && when (request.mode) {
        HandoverMode.SIGN_DEVICE -> gift is HandoverGift.Signed && suite.peerName(caller) == null && suite.isSyncApp(caller)
        else -> gift is HandoverGift.Keys && suite.peerName(caller) == request.asker
    }
    if (!stillPasses) return Activity.RESULT_CANCELED to refusalResult(HandoverRefusal.REFUSED)
    return Activity.RESULT_OK to when (gift) {
        is HandoverGift.Keys -> keysResult(gift.keys)
        is HandoverGift.Signed -> signedResult(gift.signed)
    }
}

/** What came back from a keeper's handover screen, as the asking app reads it. */
internal sealed interface KeeperAnswer {
    /** The keys, read and checked by `core/crypto`. */
    class Keys(val keys: HandedOverKeys) : KeeperAnswer

    /** The signed join of [HandoverMode.SIGN_DEVICE], read and checked by `core/crypto`. */
    class Signed(val signed: SignedJoin) : KeeperAnswer

    /** The app has no keys of the recovery key that the Sync app named. */
    data object OtherKey : KeeperAnswer

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
         * Reads what [keeper] answered to a request in [mode]. The keeper is
         * checked again first: the app that answered must still be one this
         * app may take keys from.
         */
        fun of(keeper: String, result: ActivityResult, suite: SuiteApps, mode: HandoverMode): KeeperAnswer {
            if (suite.peerName(keeper) == null) return NotASuiteApp
            val extras = try {
                result.data?.extras
            } catch (_: RuntimeException) {
                return Unreadable
            }
            if (result.resultCode == Activity.RESULT_OK) {
                if (extras == null) return Unreadable
                return try {
                    if (mode == HandoverMode.SIGN_DEVICE) Signed(SignedJoin.readFrom(extras)) else Keys(HandedOverKeys.readFrom(extras))
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
                HandoverRefusal.OTHER_KEY.name -> if (mode == HandoverMode.SIGN_DEVICE) OtherKey else Declined
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
 * state holds the application ID of the app that was asked and the mode it
 * was asked in, which are not secret, and nothing else: the answer still
 * reaches [onAnswer] with them.
 */
internal class KeeperCall(
    activity: ComponentActivity,
    private val suite: SuiteApps,
    private val keeper: () -> String?,
    private val onAnswer: (keeper: String, answer: KeeperAnswer) -> Unit,
) {
    private val restored = activity.savedStateRegistry.consumeRestoredStateForKey(STATE_KEY)

    /** The app asked last, until it answers. */
    private var asked: String? = restored?.getString(ASKED)

    /** The mode it was asked in. A state of an older version names none: then it was asked for keys. */
    private var askedMode: HandoverMode =
        HandoverMode.entries.firstOrNull { it.name == restored?.getString(MODE) } ?: HandoverMode.KEYS

    /** True while an asked app has not answered yet, also after Android made the screen anew. */
    val waiting: Boolean get() = asked != null

    private val launcher = activity.activityResultRegistry.register(
        REGISTRY_KEY,
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val packageName = asked ?: return@register
        asked = null
        onAnswer(packageName, KeeperAnswer.of(packageName, result, suite, askedMode))
    }

    init {
        activity.savedStateRegistry.registerSavedStateProvider(STATE_KEY) {
            Bundle().apply {
                asked?.let {
                    putString(ASKED, it)
                    putString(MODE, askedMode.name)
                }
            }
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
        private const val MODE = "mode"
    }

    /**
     * Opens the keeper's handover screen for [mode], after checking the
     * keeper. A keeper that fails is answered at once. [join] is what the
     * Sync app asks to be signed, for [HandoverMode.SIGN_DEVICE] only.
     */
    fun ask(mode: HandoverMode, join: DeviceJoinRequest? = null) {
        val packageName = keeper() ?: return
        val intent = if (suite.peerName(packageName) != null) suite.handoverIntent(packageName, mode, join) else null
        if (intent == null) {
            onAnswer(packageName, KeeperAnswer.NotASuiteApp)
            return
        }
        asked = packageName
        askedMode = mode
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
