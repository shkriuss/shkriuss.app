package app.shkriuss.feature.sync

import android.app.Application
import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ContentProvider
import android.content.ContentValues
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.ProviderInfo
import android.content.pm.Signature
import android.content.pm.SigningInfo
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.os.ParcelFileDescriptor
import app.shkriuss.core.crypto.AppName
import app.shkriuss.core.crypto.KeyId
import app.shkriuss.core.crypto.fixtures.SoftwareKeysApp
import app.shkriuss.core.data.Clock
import app.shkriuss.core.security.CourierApp
import app.shkriuss.core.sync.ComparisonState
import app.shkriuss.core.sync.Courier
import app.shkriuss.core.sync.Refusal
import app.shkriuss.core.sync.SendBlock
import app.shkriuss.core.sync.SyncCounts
import app.shkriuss.core.sync.SyncStatus
import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowContentProvider

/** An app class for the tests: [SyncServices] with keys on the stand-in for the Keystore, and a server that never answers. */
class TestSyncHost : Application(), SyncHost {
    override val sync: SyncServices by lazy {
        val keys = SoftwareKeysApp(File(cacheDir, "shk-keys"), AppName.of("sync")).crypto.sync
        SyncServices(SyncStateStore(MemoryPreferences()), keys, SyncServer({ HttpResult.NoAnswer }, keys, Clock.System), FakeCouriers(), FakeScheduler(), { false }, Clock.System, "Test")
    }
}

/**
 * The parts of Sync that Android makes or that pass through Android:
 * Sync's own courier provider and its check of the caller, the jobs of
 * JobScheduler, and the courier calls as bundles and pipes.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = TestSyncHost::class)
class SyncAndroidPartsTest {
    private val app = RuntimeEnvironment.getApplication()
    private val packages = shadowOf(app.packageManager)
    private val suiteCertificate = byteArrayOf(1, 2, 3, 4, 5)
    private val otherCertificate = byteArrayOf(9, 8, 7)

    private fun signing(certificate: ByteArray) = SigningInfo().also { shadowOf(it).setSignatures(arrayOf(Signature(certificate))) }

    private fun install(packageName: String, certificate: ByteArray) {
        packages.installPackage(
            PackageInfo().apply {
                this.packageName = packageName
                applicationInfo = ApplicationInfo().apply { this.packageName = packageName }
                signingInfo = signing(certificate)
            },
        )
    }

    @Before
    fun signThisAppWithTheSuiteKey() {
        packages.getInternalMutablePackageInfo(app.packageName).signingInfo = signing(suiteCertificate)
    }

    @Test
    fun theCourierProviderAnswersOnlyADataAppSignedWithThisCertificate() {
        install("app.shkriuss.water", suiteCertificate)
        install("app.shkriuss.thief", otherCertificate)
        install("app.shkriuss.catalog", suiteCertificate)
        install("app.shkriuss.water.preview", suiteCertificate)
        val provider = Robolectric.setupContentProvider(SyncCourierProvider::class.java, "${app.packageName}.courier")
        val shadow = Shadow.extract<ShadowContentProvider>(provider)
        val extras = Bundle().apply { putInt(Courier.VERSION_KEY, Courier.VERSION) }

        assertNull("Android named no caller", provider.call(Courier.STATE, null, extras))
        shadow.setCallingPackage("app.shkriuss.water")
        assertNotNull(provider.call(Courier.STATE, null, extras)?.getByteArray(Courier.BYTES))
        assertNull("another call", provider.call(Courier.STATUS, null, extras))
        listOf("app.shkriuss.thief", "app.shkriuss.catalog", "app.shkriuss.water.preview", "app.shkriuss.missing", app.packageName).forEach {
            shadow.setCallingPackage(it)
            assertNull(it, provider.call(Courier.STATE, null, extras))
        }
    }

    @Test
    fun thePeriodicJobIsAskedForOnceAndAJobSoonKeepsTheOneThatWaits() {
        val jobs = app.getSystemService(JobScheduler::class.java)
        val scheduler = JobSchedulerScheduler(app)
        scheduler.schedulePeriodic()
        val periodic = jobs.getPendingJob(JobSchedulerScheduler.PERIODIC_JOB)!!
        assertEquals(JobSchedulerScheduler.PERIOD_MILLIS, periodic.intervalMillis)
        assertTrue(periodic.isPersisted)
        assertNotNull("it waits for a network", periodic.requiredNetwork)
        scheduler.schedulePeriodic()
        assertEquals(1, jobs.allPendingJobs.count { it.id == JobSchedulerScheduler.PERIODIC_JOB })

        assertTrue(scheduler.runSoon(asked = false))
        assertTrue(scheduler.runSoon(asked = false))
        assertEquals(false, jobs.getPendingJob(JobSchedulerScheduler.SOON_JOB)!!.extras.getBoolean(JobSchedulerScheduler.ASKED))
        assertTrue("Sync now takes the place of a poke's job", scheduler.runSoon(asked = true))
        assertEquals(true, jobs.getPendingJob(JobSchedulerScheduler.SOON_JOB)!!.extras.getBoolean(JobSchedulerScheduler.ASKED))
        assertTrue("a poke keeps the job of Sync now", scheduler.runSoon(asked = false))
        assertEquals(true, jobs.getPendingJob(JobSchedulerScheduler.SOON_JOB)!!.extras.getBoolean(JobSchedulerScheduler.ASKED))

        scheduler.cancel()
        assertEquals(emptyList<JobInfo>(), jobs.allPendingJobs)
    }

    private val water = CourierApp("app.shkriuss.water", "Water", AppName.of("water"))
    private val context = CourierContext(syncId(1), syncId(2), syncId(3), KeyId(0x0a0b0c0d))

    private fun status(): SyncStatus = SyncStatus(
        1, 1, isOn = true, canSyncNow = true, epoch = syncId(2), cursor = 4, known = 5, keyId = KeyId(1), comparison = ComparisonState.NONE,
        hasOrdinaryChanges = true, hasComparisonRecords = false, hasStreamsToMove = false, wantsFetch = false, sendBlock = SendBlock.NONE,
        counts = SyncCounts(0, 0, 0, 0, 0, 0, 0),
    )

    @Test
    fun everyCourierCallCarriesItsVersionAndWhatSyncLastLearned() {
        var seen: Bundle? = null
        var method: String? = null
        val couriers = AndroidCouriers(app) { packageName, called, extras ->
            assertEquals("app.shkriuss.water", packageName)
            method = called
            seen = extras
            Bundle().apply { putByteArray(Courier.BYTES, status().toBytes()) }
        }
        val answer = couriers.status(water, context) as CourierAnswer.Done
        assertEquals(4, answer.value.cursor)
        assertEquals(Courier.STATUS, method)
        val extras = seen!!
        assertEquals(Courier.VERSION, extras.getInt(Courier.VERSION_KEY))
        assertArrayEquals(syncId(1).toBytes(), extras.getByteArray(Courier.SERVER_ID))
        assertArrayEquals(syncId(2).toBytes(), extras.getByteArray(Courier.EPOCH))
        assertArrayEquals(syncId(3).toBytes(), extras.getByteArray(Courier.DEVICE_ID))
        assertEquals(0x0a0b0c0d, extras.getInt(Courier.KEY_ID))
    }

    @Test
    fun aRefusalNoAnswerAndABrokenAnswerAreToldApart() {
        assertEquals(CourierAnswer.Refused(Refusal.UPDATE), AndroidCouriers(app) { _, _, _ -> Bundle().apply { putString(Courier.REFUSAL, "UPDATE") } }.status(water, context))
        assertEquals(CourierAnswer.NoAnswer, AndroidCouriers(app) { _, _, _ -> null }.status(water, context))
        assertEquals(CourierAnswer.NoAnswer, AndroidCouriers(app) { _, _, _ -> Bundle().apply { putString(Courier.REFUSAL, "PLEASE") } }.status(water, context))
        assertEquals(CourierAnswer.NoAnswer, AndroidCouriers(app) { _, _, _ -> Bundle().apply { putByteArray(Courier.BYTES, ByteArray(114)) } }.status(water, context))
        assertEquals(CourierAnswer.NoAnswer, AndroidCouriers(app) { _, _, _ -> Bundle().apply { putString(Courier.BYTES, "status") } }.status(water, context))
    }

    @Test
    fun aBatchComesThroughAPipeAndIsCheckedAgainstTheLimitsGiven() {
        val batch = batchBytes(9, syncId(2), 0, 0, comparison = false, records = listOf(id(1) to blob(KeyId(1), 1)))
        fun exporting(bytes: ByteArray) = AndroidCouriers(app) { _, _, extras ->
            assertEquals(10, extras.getInt(Courier.MOST_RECORDS))
            val (read, write) = ParcelFileDescriptor.createPipe().let { it[0] to it[1] }
            ParcelFileDescriptor.AutoCloseOutputStream(write).use { it.write(bytes) }
            Bundle().apply {
                putString(Courier.RESULT, Courier.RESULT_BATCH)
                putParcelable(Courier.DESCRIPTOR, read)
            }
        }
        val answer = exporting(batch).export(water, context, comparison = false, mostRecords = 10, mostBytes = 65_536) as CourierAnswer.Done
        assertEquals(9, answer.value!!.token)
        assertArrayEquals("the server gets it without its first 17 bytes", batch.copyOfRange(17, batch.size), answer.value.body())
        assertEquals(CourierAnswer.NoAnswer, exporting(batch.copyOf(batch.size - 1)).export(water, context, false, 10, 65_536))
        val nothing = AndroidCouriers(app) { _, _, _ -> Bundle().apply { putString(Courier.RESULT, Courier.RESULT_NOTHING) } }
        assertEquals(CourierAnswer.Done(null), nothing.export(water, context, false, 10, 65_536))
    }

    /** A courier provider of a data app in the tests, which says who it is. */
    class EchoCourier : ContentProvider() {
        override fun onCreate(): Boolean = true

        override fun call(method: String, arg: String?, extras: Bundle?): Bundle = Bundle().apply { putString("answered", method) }

        override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null

        override fun getType(uri: Uri): String? = null

        override fun insert(uri: Uri, values: ContentValues?): Uri? = null

        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
    }

    /** Installs [holder] with a courier provider of Water's authority, which answers. Water itself is installed with none. */
    private fun courierHeldBy(holder: String) {
        val info = ProviderInfo().apply {
            authority = "app.shkriuss.water.courier"
            packageName = holder
            name = EchoCourier::class.java.name
        }
        if (holder != "app.shkriuss.water") install("app.shkriuss.water", suiteCertificate)
        packages.installPackage(
            PackageInfo().apply {
                packageName = holder
                applicationInfo = ApplicationInfo().apply { packageName = holder }
                providers = arrayOf(info)
                signingInfo = signing(suiteCertificate)
            },
        )
        Robolectric.buildContentProvider(EchoCourier::class.java).create(info)
    }

    @Test
    fun syncCallsACourierAuthorityOnlyWhenTheCheckedAppItselfHoldsIt() {
        courierHeldBy("app.shkriuss.thief")
        assertEquals("the authority answers", "x", app.contentResolver.call("app.shkriuss.water.courier", "x", null, null)?.getString("answered"))
        assertNull("but Water does not hold it", ResolverCaller(app).call("app.shkriuss.water", Courier.STATUS, Bundle()))
    }

    @Test
    fun syncCallsTheCourierOfTheAppThatHoldsIt() {
        courierHeldBy("app.shkriuss.water")
        assertEquals(Courier.STATUS, ResolverCaller(app).call("app.shkriuss.water", Courier.STATUS, Bundle())?.getString("answered"))
    }
}
