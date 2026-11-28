package app.shkriuss.core.security

import android.content.ComponentName
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.Signature
import android.content.pm.SigningInfo
import app.shkriuss.core.crypto.AppName
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * How the Sync app finds the data apps it carries for, and checks a caller
 * of its own courier provider (docs/architecture/sync-protocol.md, "No
 * permission of our own"): the rule of the handover, ADR 0041, point 9,
 * and the apps that fail only the comparison of certificates.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestHostApp::class)
class CourierPeersTest {
    private val suiteKey = byteArrayOf(1, 2, 3, 4)
    private val otherKey = byteArrayOf(9, 9, 9)
    private val sync = SignedApp("app.shkriuss.sync", listOf(suiteKey), multipleSigners = false)
    private val water = AppName.of("water")

    private fun app(name: String, vararg signers: ByteArray, multiple: Boolean = false) = SignedApp(name, signers.toList(), multiple)

    @Test
    fun aDataAppOnlyOtherwiseSignedIsNamedAndEveryOtherAppIsNot() {
        assertEquals(water, SuitePeers.peerName(sync, app("app.shkriuss.water", suiteKey)))
        assertNull(SuitePeers.signedOtherwise(sync, app("app.shkriuss.water", suiteKey)))
        assertEquals(water, SuitePeers.signedOtherwise(sync, app("app.shkriuss.water", otherKey)))
        assertEquals(water, SuitePeers.signedOtherwise(sync, app("app.shkriuss.water", suiteKey, otherKey)))
        assertEquals(water, SuitePeers.signedOtherwise(sync, app("app.shkriuss.water", suiteKey, multiple = true)))
        listOf(
            "Sync itself" to app("app.shkriuss.sync", otherKey),
            "Catalog" to app("app.shkriuss.catalog", otherKey),
            "a preview beside a real Sync" to app("app.shkriuss.water.preview", otherKey),
            "another package" to app("com.example.water", otherKey),
            "a longer ID" to app("app.shkriuss.water.debug", otherKey),
        ).forEach { (what, other) -> assertNull(what, SuitePeers.signedOtherwise(sync, other)) }
    }

    private val context = RuntimeEnvironment.getApplication()
    private val packages = shadowOf(context.packageManager)

    private fun signing(certificate: ByteArray) = SigningInfo().also { shadowOf(it).setSignatures(arrayOf(Signature(certificate))) }

    private fun install(packageName: String, certificate: ByteArray, label: String = packageName) {
        packages.installPackage(
            PackageInfo().apply {
                this.packageName = packageName
                applicationInfo = ApplicationInfo().apply {
                    this.packageName = packageName
                    nonLocalizedLabel = label
                }
                signingInfo = signing(certificate)
            },
        )
        val screen = ComponentName(packageName, HandoverActivity::class.java.name)
        packages.addActivityIfNotPresent(screen)
        packages.addIntentFilterForActivity(screen, IntentFilter(Handover.ACTION))
    }

    @Before
    fun signThisAppWithTheSuiteKey() {
        packages.getInternalMutablePackageInfo(context.packageName).signingInfo = signing(suiteKey)
    }

    @Test
    fun theDataAppsAreFoundByTheirHandoverScreenAndChecked() {
        install("app.shkriuss.water", suiteKey, label = "Water")
        install("app.shkriuss.notes", otherKey, label = "Notes")
        install("app.shkriuss.catalog", suiteKey)
        install("com.example.thief", suiteKey)
        val found = courierApps(context)
        assertEquals(listOf(CourierApp("app.shkriuss.water", "Water", water)), found.passed)
        assertEquals(listOf(CourierApp("app.shkriuss.notes", "Notes", AppName.of("notes"))), found.signedOtherwise)
    }

    @Test
    fun aCallerOfTheCourierProviderIsNamedOnlyFromAndroidAndOnlyIfItPasses() {
        install("app.shkriuss.water", suiteKey)
        install("app.shkriuss.notes", otherKey)
        assertEquals(water, courierPeer(context, "app.shkriuss.water"))
        assertNull("another certificate", courierPeer(context, "app.shkriuss.notes"))
        assertNull("not installed", courierPeer(context, "app.shkriuss.tasks"))
        assertNull("Android named no caller", courierPeer(context, null))
    }
}
