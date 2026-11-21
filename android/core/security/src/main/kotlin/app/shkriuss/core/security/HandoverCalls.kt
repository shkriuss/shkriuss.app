package app.shkriuss.core.security

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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

/** The result a keeper's handover screen gives with the keys. Never shown or logged: a bundle's text lists its bytes. */
internal fun keysResult(keys: HandedOverKeys): Intent = Intent().putExtras(Bundle().also { keys.writeTo(it) })

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

    /** The app is not, or no longer, an app of the suite this app may take keys from. */
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
                else -> Declined
            }
        }
    }
}

/**
 * Opens a keeper's handover screen and reads its answer, for the screens
 * of the asking app. Made in the screen's `onCreate`, so that Android
 * hands the answer straight to [onAnswer], never into a saved state.
 * [keeper] says which app was asked; it must survive a turn of the phone.
 */
internal class KeeperCall(
    activity: ComponentActivity,
    private val suite: SuiteApps,
    private val keeper: () -> String?,
    private val onAnswer: (KeeperAnswer) -> Unit,
) {
    private val launcher = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        keeper()?.let { onAnswer(KeeperAnswer.of(it, result, suite)) }
    }

    /** Opens the keeper's handover screen for [mode], after checking the keeper. A keeper that fails is answered at once. */
    fun ask(mode: HandoverMode) {
        val packageName = keeper() ?: return
        val intent = if (suite.peerName(packageName) != null) suite.handoverIntent(packageName, mode) else null
        if (intent == null) {
            onAnswer(KeeperAnswer.NotASuiteApp)
            return
        }
        try {
            launcher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            onAnswer(KeeperAnswer.NotASuiteApp)
        } catch (_: SecurityException) {
            // Android refused: this app does not hold the keeper's permission.
            onAnswer(KeeperAnswer.NotASuiteApp)
        }
    }
}
