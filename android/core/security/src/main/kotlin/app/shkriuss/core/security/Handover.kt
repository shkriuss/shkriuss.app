package app.shkriuss.core.security

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.KeyId

/**
 * The handover between apps (ADR 0041): the names that the apps of the
 * suite share, so that an app of one version can ask an app of another.
 * A change to any of them is a change of the handover's format.
 */
internal object Handover {
    /** The action of every data app's handover screen. It has no category, so it opens only when named. */
    const val ACTION = "app.shkriuss.action.HANDOVER"

    /** The version of the request, an int. */
    const val EXTRA_VERSION = "app.shkriuss.handover.REQUEST_VERSION"

    /** What the asking app wants, the name of a [HandoverMode]. */
    const val EXTRA_MODE = "app.shkriuss.handover.MODE"

    /** Why a keeper gave no keys, the name of a [HandoverRefusal]. Missing: the user did not allow it. */
    const val EXTRA_REFUSAL = "app.shkriuss.handover.REFUSAL"

    /** The version of the request that this code writes and reads. */
    const val VERSION = 1

    /** The one call of a keeper's status provider. */
    const val METHOD_STATUS = "status"

    /** The authority of the status provider of the app [packageName]: `<application ID>.keeper`. */
    fun statusAuthority(packageName: String): String = "$packageName.keeper"
}

/** What an asking app wants from a keeper. */
enum class HandoverMode {
    /** Its own keys, after the user allows it and the system prompt. */
    KEYS,

    /** Its own keys, marked "words checked", after the keeper checked four of the recovery words (ADR 0041, point 19). */
    CHECK_WORDS,
}

/** Why a keeper gave no keys, besides the user saying no. */
internal enum class HandoverRefusal {
    /** It does not keep the recovery key now. */
    NOT_KEEPER,

    /** The request is of a newer version than the keeper knows. */
    UPDATE,
}

/**
 * Another app of the suite on this phone that keeps the recovery key. It
 * passed the checks of ADR 0041, point 9. [keyId] is the short name of the
 * recovery key it keeps. Nothing here is secret.
 */
data class KeeperApp(
    /** Its application ID, for example `app.shkriuss.water`. */
    val packageName: String,
    /** Its name, as Android shows it. */
    val label: String,
    /** The short name of the recovery key it keeps, eight hex digits. */
    val keyId: String,
)

/**
 * The other apps of the suite on this phone, as this app may see them
 * (ADR 0041, points 9 to 14). Screens take it through their constructor;
 * [AndroidSuiteApps] asks Android, tests pass their own.
 */
internal interface SuiteApps {
    /**
     * The app name of [packageName] if that app may take part in a
     * handover with this one: another data app of the suite, of the same
     * build kind, signed with exactly this app's current certificate.
     * Null if not, or if it is not installed.
     */
    fun peerName(packageName: String): AppName?

    /** Every other app of the suite on this phone that passes [peerName] and keeps the recovery key now. Slow: it asks each one. */
    fun keepers(): List<KeeperApp>

    /** The name Android shows for [packageName], or the package name itself. */
    fun labelOf(packageName: String): String

    /** The request that opens the handover screen of [packageName], or null if it has none. */
    fun handoverIntent(packageName: String, mode: HandoverMode): Intent?

    /** The intent that opens [packageName] from the launcher, or null. */
    fun launchIntent(packageName: String): Intent?

    /** No other app on the phone. For tests and samples that need none. */
    object None : SuiteApps {
        override fun peerName(packageName: String): AppName? = null

        override fun keepers(): List<KeeperApp> = emptyList()

        override fun labelOf(packageName: String): String = packageName

        override fun handoverIntent(packageName: String, mode: HandoverMode): Intent? = null

        override fun launchIntent(packageName: String): Intent? = null
    }
}

/** One installed app as Android describes it: its package name and the certificates it is signed with now. */
internal class SignedApp(val packageName: String, val signers: List<ByteArray>, val multipleSigners: Boolean)

/** The rule of ADR 0041, point 9, on its own, so that it can be tested without Android. */
internal object SuitePeers {
    private const val ID_PREFIX = "app.shkriuss."
    private const val PREVIEW_SUFFIX = ".preview"

    /**
     * The app name of [other] if it may take part in a handover with
     * [own]: not [own] itself; `app.shkriuss.<name>`, with `.preview`
     * exactly when [own] is a preview; a name that holds data keys; and
     * exactly one signer on each side, with the same certificate bytes.
     * The current certificate is compared, never the lineage. Null if not.
     */
    fun peerName(own: SignedApp, other: SignedApp): AppName? {
        if (other.packageName == own.packageName) return null
        val preview = own.packageName.endsWith(PREVIEW_SUFFIX)
        val name = nameOf(other.packageName, preview) ?: return null
        if (!name.holdsDataKeys || name == nameOf(own.packageName, preview)) return null
        if (own.multipleSigners || other.multipleSigners) return null
        val ownCertificate = own.signers.singleOrNull() ?: return null
        val otherCertificate = other.signers.singleOrNull() ?: return null
        return if (ownCertificate.contentEquals(otherCertificate)) name else null
    }

    /** The app name of [packageName] if it is exactly `app.shkriuss.<name>`, plus `.preview` when [preview]. */
    private fun nameOf(packageName: String, preview: Boolean): AppName? {
        val rest = packageName.removePrefix(ID_PREFIX).takeIf { packageName.startsWith(ID_PREFIX) } ?: return null
        val value = if (preview) rest.removeSuffix(PREVIEW_SUFFIX).takeIf { rest.endsWith(PREVIEW_SUFFIX) } else rest
        return try {
            value?.let(AppName::of)
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}

/** What a keeper's status provider answers: whether it keeps the recovery key, and the short name of that key. */
internal object KeeperStatus {
    private const val VERSION_KEY = "app.shkriuss.keeper.VERSION"
    private const val KEEPS_KEY = "app.shkriuss.keeper.KEEPS"
    private const val KEY_ID_KEY = "app.shkriuss.keeper.KEY_ID"

    /** The answer of an app that keeps the key with the ID [keyId], or of one that does not, when [keyId] is null. */
    fun bundleOf(keyId: KeyId?): Bundle = Bundle().apply {
        putInt(VERSION_KEY, Handover.VERSION)
        putBoolean(KEEPS_KEY, keyId != null)
        if (keyId != null) putInt(KEY_ID_KEY, keyId.value)
    }

    /** The short name of the key a keeper keeps, from its answer, or null if it keeps none or the answer is not one of ours. */
    fun keyIdOf(answer: Bundle): String? = try {
        if (answer.getInt(VERSION_KEY, 0) != Handover.VERSION || !answer.getBoolean(KEEPS_KEY, false)) {
            null
        } else if (!answer.containsKey(KEY_ID_KEY)) {
            null
        } else {
            KeyId(answer.getInt(KEY_ID_KEY)).toString()
        }
    } catch (_: RuntimeException) {
        null
    }
}

/** [SuiteApps] as Android sees them: the package manager, and each keeper's status provider. */
internal class AndroidSuiteApps(private val context: Context) : SuiteApps {
    private val packages: PackageManager = context.packageManager

    override fun peerName(packageName: String): AppName? {
        val own = signedApp(context.packageName) ?: return null
        val other = signedApp(packageName) ?: return null
        return SuitePeers.peerName(own, other)
    }

    override fun keepers(): List<KeeperApp> = candidates().mapNotNull { packageName ->
        keyIdOf(packageName)?.let { KeeperApp(packageName, labelOf(packageName), it) }
    }

    override fun labelOf(packageName: String): String = try {
        packages.getApplicationLabel(packages.getApplicationInfo(packageName, PackageManager.ApplicationInfoFlags.of(0))).toString()
    } catch (_: PackageManager.NameNotFoundException) {
        packageName
    }

    override fun handoverIntent(packageName: String, mode: HandoverMode): Intent? {
        val screen = handoverScreens(Intent(Handover.ACTION).setPackage(packageName)).firstOrNull() ?: return null
        return Intent()
            .setClassName(packageName, screen.activityInfo.name)
            .putExtra(Handover.EXTRA_VERSION, Handover.VERSION)
            .putExtra(Handover.EXTRA_MODE, mode.name)
    }

    override fun launchIntent(packageName: String): Intent? = packages.getLaunchIntentForPackage(packageName)

    /** The other apps of the suite with a handover screen that pass [peerName]. */
    private fun candidates(): List<String> = handoverScreens(Intent(Handover.ACTION))
        .map { it.activityInfo.packageName }
        .distinct()
        .filter { peerName(it) != null }

    private fun handoverScreens(intent: Intent) = packages.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0))

    /** What the status provider of [packageName] says. Null for any failure: then it counts as no keeper. */
    private fun keyIdOf(packageName: String): String? = try {
        context.contentResolver.call(Handover.statusAuthority(packageName), Handover.METHOD_STATUS, null, null)
            ?.let(KeeperStatus::keyIdOf)
    } catch (_: RuntimeException) {
        null
    }

    private fun signedApp(packageName: String): SignedApp? = try {
        val flags = PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong())
        val signing = packages.getPackageInfo(packageName, flags).signingInfo
        signing?.let { SignedApp(packageName, it.apkContentsSigners.orEmpty().map { signer -> signer.toByteArray() }, it.hasMultipleSigners()) }
    } catch (_: PackageManager.NameNotFoundException) {
        null
    }
}
