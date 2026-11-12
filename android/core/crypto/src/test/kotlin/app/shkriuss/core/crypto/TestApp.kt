package app.shkriuss.core.crypto

import app.shkriuss.core.crypto.fixtures.SoftwareHardwareKeys
import java.io.File
import java.io.IOException

/** Thrown by [StoppingStore] where a test lets the app stop. */
internal class Stopped : IOException("The app stopped here")

/**
 * A [KeysetStore] that can stop before a chosen change, as if the app was
 * killed at that moment. It also records every change.
 */
internal class StoppingStore(private val files: KeysetStore) : KeysetStore {
    /** The change to stop before, counting replacements and removals from 1. Null: never stop. */
    var stopBeforeChange: Int? = null

    /** The changes that were made, in order: the keyset name, with `-` in front for a removal. */
    val changes = mutableListOf<String>()

    override fun read(name: KeysetName): ByteArray? = files.read(name)

    override fun replace(name: KeysetName, blob: ByteArray) {
        stopIfDue()
        files.replace(name, blob)
        changes += name.text
    }

    override fun delete(name: KeysetName) {
        stopIfDue()
        files.delete(name)
        changes += "-${name.text}"
    }

    override fun tidy(): Boolean = files.tidy()

    private fun stopIfDue() {
        if (stopBeforeChange == changes.size + 1) throw Stopped()
    }
}

/**
 * One installed app in a test: its keyset files in [folder] and its
 * hardware keys. [open] is one run of the app. A new call is the app
 * started again, with nothing in memory.
 */
internal class TestApp(val folder: File, val hardware: SoftwareHardwareKeys = SoftwareHardwareKeys()) {
    /** The store of the last run, to stop it in the middle and to see what it changed. */
    lateinit var store: StoppingStore
        private set

    /** The vault of the last run, for what the tests look at directly. */
    lateinit var vault: KeyVault
        private set

    /** Starts the app. With [start] it also runs what an app does at start. */
    fun open(start: Boolean = true): ShkCrypto {
        store = StoppingStore(KeysetFiles(folder))
        vault = KeyVault(TestKeys.water, store, hardware)
        return ShkCrypto(vault).also { if (start) it.start() }
    }

    /** The hardware key the stored keyset names, or null. */
    fun keyOf(name: KeysetName): HardwareKeyRef? = KeysetFiles(folder).read(name)?.let { WrappedKeyset.keyOf(it, name) }

    /** The bytes of every keyset file, to check that nothing was changed. */
    fun snapshot(): Map<String, String> =
        folder.listFiles().orEmpty().sortedBy { it.name }.associate { it.name to it.readBytes().toHex() }
}
