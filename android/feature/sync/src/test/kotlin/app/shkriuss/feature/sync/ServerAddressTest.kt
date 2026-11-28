package app.shkriuss.feature.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** What the user types as the server's address (docs/apps/sync/spec.md, "Limits and defaults"). */
class ServerAddressTest {
    @Test
    fun anAddressIsTakenInTheFormOfAStatement() {
        assertEquals("https://sync.example.workers.dev", ServerAddress.of("sync.example.workers.dev"))
        assertEquals("https://sync.example.workers.dev", ServerAddress.of("  HTTPS://Sync.Example.Workers.Dev/  "))
        assertEquals("https://sync.example.workers.dev", ServerAddress.of("https://sync.example.workers.dev:443"))
        assertEquals("https://sync.example.org:8443", ServerAddress.of("sync.example.org:8443"))
    }

    @Test
    fun aHostNameInOtherLettersIsTurnedIntoItsAsciiForm() {
        assertEquals("https://xn--syn-8pa.example.org", ServerAddress.of("synċ.example.org"))
    }

    @Test
    fun anythingButOnlyAnAddressIsRefused() {
        listOf(
            "",
            "http://sync.example.workers.dev",
            "ftp://sync.example.workers.dev",
            "sync.example.workers.dev/v1",
            "sync.example.workers.dev?a=1",
            "user@sync.example.workers.dev",
            "sync example.org",
            "192.168.1.1",
            "[::1]",
            "sync.example.org:0",
            "sync.example.org:65536",
            "sync.example.org:08443",
            "sync.example.org:",
            "-sync.example.org",
        ).forEach { assertNull(it, ServerAddress.of(it)) }
    }

    @Test
    fun aScreenNamesTheServerWithoutTheScheme() {
        assertEquals("sync.example.workers.dev", ServerAddress.shown("https://sync.example.workers.dev"))
    }
}
