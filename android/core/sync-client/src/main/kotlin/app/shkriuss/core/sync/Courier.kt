package app.shkriuss.core.sync

/**
 * The names of the courier interface (docs/architecture/sync-protocol.md,
 * "Names of the calls"): the authority of each app's provider, the calls
 * and the keys of their arguments and answers. The Sync app and every data
 * app use these, so the two sides can never name a value differently.
 * Every name here is part of the format: changing one is a format change.
 *
 * A call is `ContentResolver.call` on the provider. Its arguments are the
 * extras. Batches, pages, lists of streams and streams pass as a
 * `ParcelFileDescriptor` under [DESCRIPTOR] or [PAGE]. Everything else is
 * small and passes as a value.
 */
object Courier {
    /** The version of the courier interface this code speaks. Every call carries it under [VERSION_KEY]. */
    const val VERSION: Int = SyncFormat.COURIER_VERSION

    /** The authority of the courier provider of the app [packageName]: `<application ID>.courier`. */
    fun authority(packageName: String): String = "$packageName.courier"

    /** The calls of a data app's provider. */
    const val STATUS: String = "status"
    const val COMPARE: String = "compare"
    const val EXPORT: String = "export"
    const val EXPORTED: String = "exported"
    const val IMPORT: String = "import"
    const val STREAMS: String = "streams"
    const val READ_STREAM: String = "readStream"
    const val STREAM_SENT: String = "streamSent"
    const val WRITE_STREAM: String = "writeStream"
    const val FINISH_STREAM: String = "finishStream"
    const val STREAM_DELETED: String = "streamDeleted"

    /** The calls of the Sync app's provider. */
    const val POKE: String = "poke"
    const val STATE: String = "state"

    private const val PREFIX = "app.shkriuss.courier."

    /** Int: the version of the courier interface the caller speaks. In every call. */
    const val VERSION_KEY: String = PREFIX + "VERSION"

    /** Byte array of 16: the server ID. In every call of the Sync app. */
    const val SERVER_ID: String = PREFIX + "SERVER_ID"

    /** Byte array of 16: the epoch. In every call of the Sync app. */
    const val EPOCH: String = PREFIX + "EPOCH"

    /** Byte array of 16: the device ID. In every call of the Sync app. */
    const val DEVICE_ID: String = PREFIX + "DEVICE_ID"

    /** Int: the server's current key ID, the four bytes as one big-endian number. In every call of the Sync app. */
    const val KEY_ID: String = PREFIX + "KEY_ID"

    /** Boolean, for `export`: true for the records of a comparison of everything, false for ordinary changes. */
    const val COMPARISON: String = PREFIX + "COMPARISON"

    /** Int, for `export`: the most records the batch may hold, 1 to 100. */
    const val MOST_RECORDS: String = PREFIX + "MOST_RECORDS"

    /**
     * Int, for `export`: the most bytes of blobs the batch may hold, 50 to
     * 524,288: the byte limit of `info`, halved after each lack of CPU
     * time. One record alone is always allowed.
     */
    const val MOST_BYTES: String = PREFIX + "MOST_BYTES"

    /** Long, for `exported`: the token of the batch, from its bytes 9 to 16. */
    const val TOKEN: String = PREFIX + "TOKEN"

    /** Byte array, for `exported`: the server's whole answer to the batch, from its answer byte on. */
    const val ANSWER: String = PREFIX + "ANSWER"

    /** `ParcelFileDescriptor`, for `import`: the read end that gives one page, as the server answered it. */
    const val PAGE: String = PREFIX + "PAGE"

    /** Byte array of 16, for the calls on one stream: the file ID. */
    const val FILE_ID: String = PREFIX + "FILE_ID"

    /** Byte array of 32, for `streamSent`: the SHA-256 that `streams` named. */
    const val HASH: String = PREFIX + "HASH"

    /** Boolean, for `streamSent`: true when every chunk is on the server, false when the stream did not fit its hash. */
    const val FITS: String = PREFIX + "FITS"

    /** Long, for `writeStream`: how many bytes of the fetch are here, as `streams` listed them. */
    const val BYTES_HERE: String = PREFIX + "BYTES_HERE"

    /**
     * String, in an answer: why the call was refused as a whole, the name
     * of one [Refusal]. Nothing was written. An answer with it holds
     * nothing else.
     */
    const val REFUSAL: String = PREFIX + "REFUSAL"

    /**
     * String, in an answer: what the call did. For `export` one of
     * [RESULT_BATCH] and [RESULT_NOTHING]; for `exported` a name of
     * [ExportedResult]; for `import` [RESULT_TAKEN] or [RESULT_DROPPED];
     * for `finishStream` a name of [StreamFinish].
     */
    const val RESULT: String = PREFIX + "RESULT"

    const val RESULT_BATCH: String = "BATCH"
    const val RESULT_NOTHING: String = "NOTHING"
    const val RESULT_TAKEN: String = "TAKEN"
    const val RESULT_DROPPED: String = "DROPPED"

    /** Byte array, in an answer: the layout of `status` (115 bytes) or of `state` ([SyncAppState.BYTES]). */
    const val BYTES: String = PREFIX + "BYTES"

    /**
     * `ParcelFileDescriptor`, in an answer: for `export` the read end that
     * gives the batch, for `streams` the read end that gives the list, for
     * `readStream` the read end that gives the stored stream, and for
     * `writeStream` the write end that takes the rest of a fetch.
     */
    const val DESCRIPTOR: String = PREFIX + "DESCRIPTOR"

    /** Int, in the answer to `import`: how many records the app took. */
    const val RECORDS: String = PREFIX + "RECORDS"

    /** Long, in the answer to `import`: the app's cursor now. */
    const val CURSOR: String = PREFIX + "CURSOR"
}
