package app.shkriuss.feature.sync

import app.shkriuss.core.crypto.DeviceKey
import app.shkriuss.core.crypto.RequestMethod
import app.shkriuss.core.crypto.SignedJoin
import app.shkriuss.core.crypto.SyncKeys
import app.shkriuss.core.data.Clock
import app.shkriuss.core.sync.ExportedBatch
import app.shkriuss.core.sync.SyncId
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.cert.CertPathValidatorException
import java.security.cert.CertificateException
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

/** One request as it goes out: the whole URL, the method, its headers and its body. */
class HttpRequest(val url: String, val method: RequestMethod, val headers: Map<String, String>, val body: ByteArray?) {
    override fun toString(): String = "HttpRequest($method)"
}

/** What came back for one request. */
sealed interface HttpResult {
    /** An answer, with its HTTP status and its body. */
    class Answer(val status: Int, val body: ByteArray) : HttpResult

    /** No answer: no connection, no such host, a failed handshake, a body too long, or a time-out. */
    data object NoAnswer : HttpResult

    /** The server's certificate is not one Android trusts. */
    data object Untrusted : HttpResult
}

/** Sends one request and gives back what came. Tests pass their own. */
fun interface Transport {
    fun send(request: HttpRequest): HttpResult
}

/**
 * Android's own HTTP client, as the protocol asks (docs/architecture/
 * sync-protocol.md, "The connection"): HTTPS only, no redirect followed, no
 * cache, one fixed `User-Agent`. The network security configuration of
 * the app forbids cleartext and trusts only the authorities built into
 * Android.
 */
class HttpsTransport : Transport {
    override fun send(request: HttpRequest): HttpResult {
        val connection = try {
            URL(request.url).openConnection() as? HttpsURLConnection ?: return HttpResult.NoAnswer
        } catch (_: IOException) {
            return HttpResult.NoAnswer
        }
        return try {
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.connectTimeout = CONNECT_TIMEOUT_MILLIS
            connection.readTimeout = READ_TIMEOUT_MILLIS
            connection.requestMethod = request.method.name
            connection.setRequestProperty("User-Agent", USER_AGENT)
            request.headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
            val body = request.body
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/octet-stream")
                connection.setFixedLengthStreamingMode(body.size)
                connection.outputStream.use { it.write(body) }
            }
            val status = connection.responseCode
            val stream = if (status < HttpURLConnection.HTTP_BAD_REQUEST) connection.inputStream else connection.errorStream
            // An answer longer than any of the protocol is no answer.
            val answer = if (stream == null) ByteArray(0) else stream.use { readAtMost(it, MOST_ANSWER_BYTES) }
            answer?.let { HttpResult.Answer(status, it) } ?: HttpResult.NoAnswer
        } catch (error: IOException) {
            resultOf(error)
        } catch (_: SecurityException) {
            HttpResult.NoAnswer
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        /** The one `User-Agent` of every phone, so that a request does not name the phone's model. */
        const val USER_AGENT: String = "shkriuss-sync/1"

        private const val CONNECT_TIMEOUT_MILLIS = 30_000
        private const val READ_TIMEOUT_MILLIS = 60_000

        /** More than any answer of the protocol: 4 MiB of chunks and their table. */
        private const val MOST_ANSWER_BYTES = 4_194_304 + 65_536

        /**
         * What a connection that failed with [error] counts as: a
         * certificate this phone does not trust, or one for another host
         * name, is [HttpResult.Untrusted]; anything else is no answer.
         */
        internal fun resultOf(error: IOException): HttpResult = when {
            // A trusted certificate for another name: the host name check after the handshake fails.
            error is SSLPeerUnverifiedException -> HttpResult.Untrusted
            error is SSLHandshakeException && isUntrusted(error) -> HttpResult.Untrusted
            else -> HttpResult.NoAnswer
        }

        private fun isUntrusted(error: Throwable): Boolean {
            var cause: Throwable? = error
            while (cause != null) {
                if (cause is CertPathValidatorException || cause is CertificateException) return true
                cause = cause.cause
            }
            return false
        }

        /** The bytes of [input], or null if there are more than [most]. */
        internal fun readAtMost(input: InputStream, most: Int): ByteArray? {
            val out = ByteArrayOutputStream()
            val buffer = ByteArray(65_536)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) return out.toByteArray()
                if (out.size() + read > most) return null
                out.write(buffer, 0, read)
            }
        }
    }
}

/** What a signed request needs: the server, and this phone's device key. */
class Session(val address: String, val serverId: SyncId, val key: DeviceKey) {
    override fun toString(): String = "Session"
}

/**
 * The calls of the server interface, version 1 (docs/architecture/
 * sync-protocol.md, "The server interface"). Every call but `info` is
 * signed with the device key. A `04` is sent again once, with a new time
 * and signature, before it counts (rule 7 makes that harmless).
 *
 * Signing can throw [app.shkriuss.core.crypto.DeviceKeyGoneException] when
 * the device key is gone for good, and [app.shkriuss.core.crypto.BlobException]
 * when the Keystore cannot be used now.
 */
class SyncServer(
    private val transport: Transport,
    private val keys: SyncKeys,
    private val clock: Clock,
    private val beforeRetry: () -> Unit = {},
) {
    /** The same calls, with [check] before a `04` is sent again: a run ends there when Android stopped its job. */
    fun checkingBeforeRetry(check: () -> Unit): SyncServer = SyncServer(transport, keys, clock, check)

    /** `GET /v1/info`. Not signed. */
    fun info(address: String): ServerAnswer<ServerInfo> =
        answerOf(transport.send(HttpRequest(address + INFO, RequestMethod.GET, emptyMap(), null))) { ServerLayouts.answer(it, ServerLayouts::info) }

    /** `POST /v1/enrol`, signed with the device key that the statement holds. */
    fun enrol(session: Session, codeKind: CodeKind, code: String, signed: SignedJoin, sealedName: ByteArray): ServerAnswer<SyncId> {
        val body = ServerLayouts.enrolBody(codeKind, code, signed.statement, signed.signature, signed.accountPublicKey, sealedName)
        return signed(session, RequestMethod.POST, "/v1/enrol", body) { ServerLayouts.answer(it, ServerLayouts::epoch) }
    }

    /** `POST /v1/enrol-code`: a new device code, which voids the one before. */
    fun enrolCode(session: Session): ServerAnswer<DeviceCode> =
        signed(session, RequestMethod.POST, "/v1/enrol-code", ByteArray(0)) { ServerLayouts.answer(it, ServerLayouts::deviceCode) }

    /** `GET /v1/devices`. */
    fun devices(session: Session): ServerAnswer<List<ListedDevice>> =
        signed(session, RequestMethod.GET, "/v1/devices", null) { ServerLayouts.answer(it, ServerLayouts::devices) }

    /** `POST /v1/devices/remove`: the account revision after it. */
    fun removeDevice(session: Session, id: SyncId): ServerAnswer<Long> =
        signed(session, RequestMethod.POST, "/v1/devices/remove", id.toBytes()) { ServerLayouts.answer(it, ServerLayouts::revision) }

    /** `POST /v1/devices/name`: the account revision after it. */
    fun renameDevice(session: Session, sealedName: ByteArray): ServerAnswer<Long> =
        signed(session, RequestMethod.POST, "/v1/devices/name", ServerLayouts.sealedNameBody(sealedName)) {
            ServerLayouts.answer(it, ServerLayouts::revision)
        }

    /** `GET /v1/heads`. */
    fun heads(session: Session): ServerAnswer<Heads> =
        signed(session, RequestMethod.GET, "/v1/heads", null) { ServerLayouts.answer(it, ServerLayouts::heads) }

    /** Fetch: `GET /v1/changes`, one page of [app] above [since]. */
    fun fetch(session: Session, app: String, since: Long, known: Long, epoch: SyncId, most: Int): ServerAnswer<FetchedPage> {
        val path = "/v1/changes?app=$app&since=$since&known=$known&epoch=${epoch.hex}&most=$most"
        return signed(session, RequestMethod.GET, path, null, read = ServerLayouts::page)
    }

    /** Send: `POST /v1/changes`, one batch of [app]. */
    fun send(session: Session, app: String, batch: ExportedBatch): ServerAnswer<SentBatch> =
        signed(session, RequestMethod.POST, "/v1/changes?app=$app", batch.body()) { ServerLayouts.sent(it, batch.count) }

    /** `POST /v1/files/send`: for each chunk, true if it is stored, false if its hash did not fit. */
    fun filesSend(session: Session, app: String, chunks: List<OutgoingChunk>): ServerAnswer<List<Boolean>> {
        val (signedPart, body) = ServerLayouts.filesSendBody(chunks)
        return signed(session, RequestMethod.POST, "/v1/files/send?app=$app", body, signedPart) { bytes ->
            ServerLayouts.answer(bytes) { reader ->
                ServerLayouts.fileResults(reader, chunks.size)?.map {
                    when (it) {
                        0 -> true
                        1 -> false
                        else -> return@answer null
                    }
                }
            }
        }
    }

    /** `POST /v1/files/have`: for each stream, how many of its chunks the server has, from chunk 0 without a gap. */
    fun filesHave(session: Session, app: String, streams: List<StreamRef>): ServerAnswer<List<Long>> =
        signed(session, RequestMethod.POST, "/v1/files/have?app=$app", ServerLayouts.filesHaveBody(streams)) { bytes ->
            ServerLayouts.answer(bytes) { reader -> List(streams.size) { reader.u32() } }
        }

    /** `POST /v1/files/fetch`: the bytes of each chunk that is here, null for one that is not. */
    fun filesFetch(session: Session, app: String, chunks: List<ChunkRef>): ServerAnswer<List<ByteArray?>> =
        signed(session, RequestMethod.POST, "/v1/files/fetch?app=$app", ServerLayouts.filesFetchBody(chunks)) { bytes ->
            ServerLayouts.answer(bytes) { reader -> ServerLayouts.fetchedChunks(reader, chunks) }
        }

    /** `POST /v1/files/delete`: for each file, its ID and the number its deleted record was stored under. */
    fun filesDelete(session: Session, app: String, files: List<Pair<ByteArray, Long>>): ServerAnswer<List<DeleteResult>> =
        signed(session, RequestMethod.POST, "/v1/files/delete?app=$app", ServerLayouts.filesDeleteBody(files)) { bytes ->
            ServerLayouts.answer(bytes) { reader ->
                ServerLayouts.fileResults(reader, files.size)?.map { DeleteResult.entries.getOrNull(it) ?: return@answer null }
            }
        }

    /** `POST /v1/account/delete`, with the server ID as its body. */
    fun deleteAccount(session: Session): ServerAnswer<Unit> =
        signed(session, RequestMethod.POST, "/v1/account/delete", session.serverId.toBytes()) { bytes -> ServerLayouts.answer(bytes) { } }

    private fun <T> signed(
        session: Session,
        method: RequestMethod,
        pathAndQuery: String,
        body: ByteArray?,
        signedPart: ByteArray? = body,
        read: (ByteArray) -> ServerAnswer<T>,
    ): ServerAnswer<T> {
        var answer: ServerAnswer<T> = ServerAnswer.DoesNotCheck
        repeat(ATTEMPTS) { attempt ->
            if (attempt > 0) beforeRetry()
            val time = clock.nowMillis()
            val signature = keys.signRequest(session.key, session.serverId.toBytes(), time, method, pathAndQuery, signedPart ?: ByteArray(0))
            val headers = mapOf(
                "shk-device" to session.key.deviceId.toHex(),
                "shk-time" to time.toString(),
                "shk-signature" to hex(signature),
            )
            answer = answerOf(transport.send(HttpRequest(session.address + pathAndQuery, method, headers, body)), read)
            if (answer != ServerAnswer.DoesNotCheck) return answer
        }
        return answer
    }

    private fun <T> answerOf(result: HttpResult, read: (ByteArray) -> ServerAnswer<T>): ServerAnswer<T> = when (result) {
        HttpResult.NoAnswer -> ServerAnswer.Unreachable
        HttpResult.Untrusted -> ServerAnswer.UntrustedCertificate
        is HttpResult.Answer -> when (result.status) {
            HttpURLConnection.HTTP_OK -> read(result.body)
            DAY_REQUESTS_STATUS -> ServerAnswer.DayRequestsUsed
            CPU_TIME_STATUS -> ServerAnswer.OutOfCpuTime
            else -> ServerAnswer.NotTheWorker
        }
    }

    companion object {
        private const val INFO = "/v1/info"

        /** A `04` is sent again once. */
        private const val ATTEMPTS = 2

        /**
         * The HTTP status of Cloudflare's answer when the day's requests of
         * the free plan are used (its error 1027), and of its answer when a
         * request ran out of CPU time (its error 1102), as Cloudflare's
         * documentation names them. Checked on the first deployed server
         * (docs/architecture/sync-protocol.md, "Assumptions", point 8).
         */
        const val DAY_REQUESTS_STATUS: Int = 429
        const val CPU_TIME_STATUS: Int = 503

        private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }
    }
}
