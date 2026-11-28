package app.shkriuss.feature.sync

import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.ParcelFileDescriptor
import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.security.CourierApp
import app.shkriuss.core.security.CourierApps
import app.shkriuss.core.security.courierApps
import app.shkriuss.core.sync.Courier
import app.shkriuss.core.sync.ExportedBatch
import app.shkriuss.core.sync.ExportedResult
import app.shkriuss.core.sync.ListedStream
import app.shkriuss.core.sync.Refusal
import app.shkriuss.core.sync.StatusLayout
import app.shkriuss.core.sync.StreamFinish
import app.shkriuss.core.sync.StreamListLayout
import app.shkriuss.core.sync.SyncId
import app.shkriuss.core.sync.SyncStatus
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import kotlin.concurrent.thread

/** What Sync passes with every courier call: the server ID, the epoch, the device ID and the server's current key ID. */
class CourierContext(val serverId: SyncId, val epoch: SyncId, val deviceId: SyncId, val keyId: KeyId) {
    override fun toString(): String = "CourierContext"
}

/** One answer of a data app to a courier call. */
sealed interface CourierAnswer<out T> {
    /** The call was done, with what it gives. */
    data class Done<T>(val value: T) : CourierAnswer<T>

    /** The app refused the call as a whole. Nothing was written. */
    data class Refused(val refusal: Refusal) : CourierAnswer<Nothing>

    /** No answer, or one that breaks its layout: the app is left for this run. */
    data object NoAnswer : CourierAnswer<Nothing>
}

/** What `import` did with a page. */
sealed interface Imported {
    /** The page was taken: the app's cursor now. */
    data class Taken(val records: Int, val cursor: Long) : Imported

    /** The page did not check. Nothing was written, and the cursor stays. */
    data object Dropped : Imported
}

/**
 * Sync's side of the courier interface (docs/architecture/sync-protocol.md,
 * "What a data app answers"): the data apps on this phone, and each call
 * on one of them. Tests pass their own.
 */
interface Couriers {
    /** The data apps that pass the check, and those that fail only the comparison of certificates. */
    fun find(): CourierApps

    fun status(app: CourierApp, context: CourierContext): CourierAnswer<SyncStatus>

    fun compare(app: CourierApp, context: CourierContext): CourierAnswer<Unit>

    /** One batch, or null for "nothing to send". */
    fun export(app: CourierApp, context: CourierContext, comparison: Boolean, mostRecords: Int, mostBytes: Int): CourierAnswer<ExportedBatch?>

    fun exported(app: CourierApp, context: CourierContext, token: Long, answer: ByteArray): CourierAnswer<ExportedResult>

    fun import(app: CourierApp, context: CourierContext, page: ByteArray): CourierAnswer<Imported>

    fun streams(app: CourierApp, context: CourierContext): CourierAnswer<List<ListedStream>>

    /** The stored stream to read, or null when the app has none for [fileId]. The caller closes it. */
    fun readStream(app: CourierApp, context: CourierContext, fileId: ByteArray): CourierAnswer<InputStream?>

    fun streamSent(app: CourierApp, context: CourierContext, fileId: ByteArray, hash: ByteArray, fits: Boolean): CourierAnswer<Unit>

    /** Where to write the rest of a fetch, or null when the app does not want it. The caller closes it. */
    fun writeStream(app: CourierApp, context: CourierContext, fileId: ByteArray, bytesHere: Long): CourierAnswer<OutputStream?>

    fun finishStream(app: CourierApp, context: CourierContext, fileId: ByteArray): CourierAnswer<StreamFinish>

    fun streamDeleted(app: CourierApp, context: CourierContext, fileId: ByteArray): CourierAnswer<Unit>

    /**
     * The same couriers, with [check] before each read of a pipe that a
     * data app fills: a run ends there when Android stopped its job.
     */
    fun checkingBeforeRead(check: () -> Unit): Couriers = this
}

/** Calls one method of one app's courier provider. Null for no answer. Tests pass their own. */
fun interface CourierCaller {
    fun call(packageName: String, method: String, extras: Bundle): Bundle?
}

/**
 * [CourierCaller] through Android's content resolver. It calls the
 * authority `<package>.courier` only when that package itself declares
 * it: an authority is free for any app to declare while the data app that
 * should hold it has none, so the app that passed the check must be the
 * one that answers. Android installs no second app with an authority that
 * one already has, so the package that declares it holds it. A call that
 * fails in any way is no answer.
 */
class ResolverCaller(private val context: Context) : CourierCaller {
    override fun call(packageName: String, method: String, extras: Bundle): Bundle? = try {
        val authority = Courier.authority(packageName)
        if (!declares(packageName, authority)) null else context.contentResolver.call(authority, method, null, extras)
    } catch (_: RuntimeException) {
        null
    }

    private fun declares(packageName: String, authority: String): Boolean = try {
        val flags = PackageManager.PackageInfoFlags.of(PackageManager.GET_PROVIDERS.toLong())
        context.packageManager.getPackageInfo(packageName, flags).providers.orEmpty().any { provider ->
            provider.authority?.split(';')?.contains(authority) == true
        }
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }
}

/**
 * [Couriers] as Android gives them: the data apps from `core/security`'s
 * check, and each call as `ContentResolver.call` with the names of
 * [Courier]. Batches, pages and lists pass through pipes. Every answer is
 * checked against its layout: one that breaks it is no answer.
 */
class AndroidCouriers(
    private val context: Context,
    private val beforeRead: () -> Unit = {},
    private val caller: CourierCaller = ResolverCaller(context),
) : Couriers {
    override fun find(): CourierApps = courierApps(context)

    override fun checkingBeforeRead(check: () -> Unit): Couriers = AndroidCouriers(context, check, caller)

    override fun status(app: CourierApp, context: CourierContext): CourierAnswer<SyncStatus> = call(app, Courier.STATUS, context) { answer ->
        answer.getByteArray(Courier.BYTES)?.let(StatusLayout::read)
    }

    override fun compare(app: CourierApp, context: CourierContext): CourierAnswer<Unit> = call(app, Courier.COMPARE, context) { }

    override fun export(app: CourierApp, context: CourierContext, comparison: Boolean, mostRecords: Int, mostBytes: Int): CourierAnswer<ExportedBatch?> {
        val extras = Bundle().apply {
            putBoolean(Courier.COMPARISON, comparison)
            putInt(Courier.MOST_RECORDS, mostRecords)
            putInt(Courier.MOST_BYTES, mostBytes)
        }
        var batch: ExportedBatch? = null
        val answer = call(app, Courier.EXPORT, context, extras) { result ->
            when (result.getString(Courier.RESULT)) {
                Courier.RESULT_NOTHING -> true
                Courier.RESULT_BATCH -> descriptor(result)?.let { readAll(it, MOST_BATCH_BYTES) }
                    ?.let { ExportedBatch.read(it, mostRecords, mostBytes) }
                    ?.also { batch = it }
                    ?.let { true }
                else -> null
            }
        }
        return when (answer) {
            is CourierAnswer.Done -> CourierAnswer.Done(batch)
            is CourierAnswer.Refused -> answer
            CourierAnswer.NoAnswer -> CourierAnswer.NoAnswer
        }
    }

    override fun exported(app: CourierApp, context: CourierContext, token: Long, answer: ByteArray): CourierAnswer<ExportedResult> {
        val extras = Bundle().apply {
            putLong(Courier.TOKEN, token)
            putByteArray(Courier.ANSWER, answer)
        }
        return call(app, Courier.EXPORTED, context, extras) { result ->
            ExportedResult.entries.firstOrNull { it.name == result.getString(Courier.RESULT) }
        }
    }

    override fun import(app: CourierApp, context: CourierContext, page: ByteArray): CourierAnswer<Imported> {
        val pipe = try {
            ParcelFileDescriptor.createPipe()
        } catch (_: IOException) {
            return CourierAnswer.NoAnswer
        }
        val (readEnd, writeEnd) = pipe[0] to pipe[1]
        // A pipe holds only a little: the page is written while the app reads it, and the call waits for the app.
        thread(name = "sync-page") {
            try {
                ParcelFileDescriptor.AutoCloseOutputStream(writeEnd).use { it.write(page) }
            } catch (_: IOException) {
                // The app stopped reading: its answer says what it took.
            }
        }
        val extras = Bundle().apply { putParcelable(Courier.PAGE, readEnd) }
        return try {
            call(app, Courier.IMPORT, context, extras) { result ->
                when (result.getString(Courier.RESULT)) {
                    Courier.RESULT_DROPPED -> Imported.Dropped
                    Courier.RESULT_TAKEN -> {
                        val records = result.getInt(Courier.RECORDS, -1)
                        val cursor = result.getLong(Courier.CURSOR, -1)
                        if (records in 0..MOST_RECORDS && cursor >= 0) Imported.Taken(records, cursor) else null
                    }
                    else -> null
                }
            }
        } finally {
            // The writer ends when the page is written, or when the app has closed its copy of the read end, as
            // every taker of a pipe end does (sync-protocol.md, "Names of the calls", point 4).
            closeQuietly(readEnd)
        }
    }

    override fun streams(app: CourierApp, context: CourierContext): CourierAnswer<List<ListedStream>> = call(app, Courier.STREAMS, context) { result ->
        descriptor(result)?.let { readAll(it, MOST_LIST_BYTES) }?.let(StreamListLayout::read)
    }

    override fun readStream(app: CourierApp, context: CourierContext, fileId: ByteArray): CourierAnswer<InputStream?> {
        var stream: InputStream? = null
        val answer = call(app, Courier.READ_STREAM, context, fileExtras(fileId)) { result ->
            stream = descriptor(result)?.let(ParcelFileDescriptor::AutoCloseInputStream)
            true
        }
        return when (answer) {
            is CourierAnswer.Done -> CourierAnswer.Done(stream)
            is CourierAnswer.Refused -> answer
            CourierAnswer.NoAnswer -> CourierAnswer.NoAnswer
        }
    }

    override fun streamSent(app: CourierApp, context: CourierContext, fileId: ByteArray, hash: ByteArray, fits: Boolean): CourierAnswer<Unit> {
        val extras = fileExtras(fileId).apply {
            putByteArray(Courier.HASH, hash)
            putBoolean(Courier.FITS, fits)
        }
        return call(app, Courier.STREAM_SENT, context, extras) { }
    }

    override fun writeStream(app: CourierApp, context: CourierContext, fileId: ByteArray, bytesHere: Long): CourierAnswer<OutputStream?> {
        var stream: OutputStream? = null
        val extras = fileExtras(fileId).apply { putLong(Courier.BYTES_HERE, bytesHere) }
        val answer = call(app, Courier.WRITE_STREAM, context, extras) { result ->
            stream = descriptor(result)?.let(ParcelFileDescriptor::AutoCloseOutputStream)
            true
        }
        return when (answer) {
            is CourierAnswer.Done -> CourierAnswer.Done(stream)
            is CourierAnswer.Refused -> answer
            CourierAnswer.NoAnswer -> CourierAnswer.NoAnswer
        }
    }

    override fun finishStream(app: CourierApp, context: CourierContext, fileId: ByteArray): CourierAnswer<StreamFinish> =
        call(app, Courier.FINISH_STREAM, context, fileExtras(fileId)) { result ->
            StreamFinish.entries.firstOrNull { it.name == result.getString(Courier.RESULT) }
        }

    override fun streamDeleted(app: CourierApp, context: CourierContext, fileId: ByteArray): CourierAnswer<Unit> =
        call(app, Courier.STREAM_DELETED, context, fileExtras(fileId)) { }

    /**
     * Calls [method] of [app] with the arguments every call carries and
     * [extras]. A refusal is read first. [read] gives null for an answer
     * that breaks its layout.
     */
    private fun <T> call(app: CourierApp, method: String, context: CourierContext, extras: Bundle = Bundle(), read: (Bundle) -> T?): CourierAnswer<T> {
        extras.putInt(Courier.VERSION_KEY, Courier.VERSION)
        extras.putByteArray(Courier.SERVER_ID, context.serverId.toBytes())
        extras.putByteArray(Courier.EPOCH, context.epoch.toBytes())
        extras.putByteArray(Courier.DEVICE_ID, context.deviceId.toBytes())
        extras.putInt(Courier.KEY_ID, context.keyId.value)
        val result = caller.call(app.packageName, method, extras) ?: return CourierAnswer.NoAnswer
        return try {
            val refusal = result.getString(Courier.REFUSAL)
            if (refusal != null) {
                Refusal.entries.firstOrNull { it.name == refusal }?.let { CourierAnswer.Refused(it) } ?: CourierAnswer.NoAnswer
            } else {
                read(result)?.let { CourierAnswer.Done(it) } ?: CourierAnswer.NoAnswer
            }
        } catch (_: RuntimeException) {
            // A bundle whose values are of other types, or that cannot be read.
            CourierAnswer.NoAnswer
        }
    }

    private fun fileExtras(fileId: ByteArray) = Bundle().apply { putByteArray(Courier.FILE_ID, fileId) }

    private fun descriptor(result: Bundle): ParcelFileDescriptor? = result.getParcelable(Courier.DESCRIPTOR, ParcelFileDescriptor::class.java)

    /** The bytes the read end [descriptor] gives, or null if there are more than [most] or it fails. It is closed. */
    private fun readAll(descriptor: ParcelFileDescriptor, most: Int): ByteArray? = try {
        ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { HttpsTransport.readAtMost(it, most, beforeRead) }
    } catch (_: IOException) {
        null
    }

    private fun closeQuietly(descriptor: ParcelFileDescriptor) {
        try {
            descriptor.close()
        } catch (_: IOException) {
            // Closed already.
        }
    }

    private companion object {
        const val MOST_RECORDS = 100

        /** The largest batch: 54 bytes, and 100 records of 20 bytes beside blobs of 524,288 bytes together. */
        const val MOST_BATCH_BYTES = 54 + 100 * 20 + 524_288

        /** The largest list of streams that [StreamListLayout] takes. */
        const val MOST_LIST_BYTES = 9 + StreamListLayout.MOST_STREAMS * 73

    }
}
