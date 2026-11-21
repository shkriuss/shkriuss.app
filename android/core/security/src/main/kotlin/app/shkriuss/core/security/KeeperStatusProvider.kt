package app.shkriuss.core.security

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import app.shkriuss.core.crypto.BlobException

/**
 * Answers other apps of the suite one question: does this app keep the
 * recovery key now, and with which short name (ADR 0041, point 13)? It is
 * exported, and protected by the handover permission, so Android lets
 * only apps signed with the suite's key call it. It also checks the
 * caller itself, as the handover screen does. It holds no data and
 * answers nothing else: no query, no file, no change.
 */
class KeeperStatusProvider : ContentProvider() {
    /** Nothing to set up. The app's keys are read on each call, so the answer is always live. */
    override fun onCreate(): Boolean = true

    /** The one call, [Handover.METHOD_STATUS]. Any other call, or a caller that fails the checks, gets nothing. */
    override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
        if (method != Handover.METHOD_STATUS) return null
        val context = context ?: return null
        val caller = try {
            callingPackage
        } catch (_: SecurityException) {
            null
        }
        // The app class, not onCreate: a provider is made before the app class has started.
        return statusFor(caller, AndroidSuiteApps(context), context.applicationContext as? SecurityHost)
    }

    internal companion object {
        /**
         * The answer to [caller]: nothing unless it passes the checks of
         * ADR 0041, point 9. A key that cannot be read now counts as not
         * kept.
         */
        fun statusFor(caller: String?, suite: SuiteApps, host: SecurityHost?): Bundle? {
            if (caller == null || host == null || suite.peerName(caller) == null) return null
            val status = try {
                host.crypto.status()
            } catch (_: BlobException) {
                null
            }
            return KeeperStatus.bundleOf(status?.keyId?.takeIf { status.keepsRecoveryKey })
        }
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null

    override fun getType(uri: Uri): String? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
