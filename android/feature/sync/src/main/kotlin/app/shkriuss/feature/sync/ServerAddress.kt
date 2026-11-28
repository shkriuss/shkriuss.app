package app.shkriuss.feature.sync

import app.shkriuss.core.crypto.SyncAddress
import java.net.IDN

/**
 * What the user types into "Server address", turned into the form a
 * statement holds (docs/apps/sync/spec.md, "Limits and defaults"):
 * `https://`, a host name in lower-case ASCII, and `:` and a port if it is
 * not 443.
 */
object ServerAddress {
    private const val SECURE = "https://"
    private const val PLAIN = "http://"
    private const val DEFAULT_PORT = "443"
    private val PORT = Regex("[1-9][0-9]{0,4}")

    /**
     * The address in [typed], or null for anything that is not only an
     * address: "Enter only the address, such as sync.example.workers.dev."
     * Spaces at either end, one `/` at the end and `:443` are dropped, a
     * missing `https://` is added, and a host name in other letters is
     * turned into its ASCII form.
     */
    fun of(typed: String): String? {
        var rest = typed.trim()
        if (rest.startsWith(PLAIN, ignoreCase = true)) return null
        if (rest.startsWith(SECURE, ignoreCase = true)) rest = rest.substring(SECURE.length)
        if (rest.endsWith("/")) rest = rest.dropLast(1)
        if (rest.isEmpty() || rest.any { it in "/?#@[]\\" || it.isWhitespace() } || rest.contains("://")) return null
        val host = rest.substringBefore(':')
        val port = if (rest.contains(':')) rest.substringAfter(':') else null
        if (port != null && !PORT.matches(port)) return null
        val ascii = try {
            IDN.toASCII(host, IDN.USE_STD3_ASCII_RULES).lowercase()
        } catch (_: IllegalArgumentException) {
            return null
        }
        val address = SECURE + ascii + if (port == null || port == DEFAULT_PORT) "" else ":$port"
        return address.takeIf(SyncAddress::isValid)
    }

    /** The address as a screen names the server: without `https://`. */
    fun shown(address: String): String = address.removePrefix(SECURE)
}
