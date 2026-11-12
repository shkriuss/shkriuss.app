package app.shkriuss.core.crypto

import java.security.Security
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * What Tink finds on a real Android ("No Play services provider" in
 * crypto-design.md). On the JVM Tink never takes its Android path. Here it
 * does, and the vector tests of `src/sharedTest/` run on it in the same
 * suite.
 */
class TinkOnAndroidTest {
    @Test
    fun tinkTellsAndroidByJavasVendorName() {
        assertEquals("The Android Project", System.getProperty("java.vendor"))
    }

    @Test
    fun androidsOwnProviderIsThereAndThePlayServicesOneIsNot() {
        assertNotNull(Security.getProvider("AndroidOpenSSL"))
        assertNull(Security.getProvider(TinkSetup.PLAY_SERVICES_PROVIDER))
        TinkSetup.ready()
    }
}
