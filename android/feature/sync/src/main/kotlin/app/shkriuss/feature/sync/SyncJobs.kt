package app.shkriuss.feature.sync

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.PersistableBundle
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Sync's runs through Android's JobScheduler (docs/apps/sync/spec.md,
 * "When Sync runs"): one periodic job every 15 minutes with a network,
 * kept after a restart, and one job soon, for a poke and for **Sync now**.
 * Android keeps both jobs itself, with no database of Sync's own, and runs
 * none before the first unlock since the phone started, or after a force
 * stop until the user opens Sync.
 */
class JobSchedulerScheduler(context: Context) : Scheduler {
    private val jobs = context.getSystemService(JobScheduler::class.java)
    private val service = ComponentName(context, SyncJobService::class.java)

    override fun schedulePeriodic() {
        try {
            if (jobs.getPendingJob(PERIODIC_JOB) != null) return
            val job = JobInfo.Builder(PERIODIC_JOB, service)
                .setPeriodic(PERIOD_MILLIS)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .build()
            jobs.schedule(job)
        } catch (_: RuntimeException) {
            // Asked for again at the next start of Sync.
        }
    }

    override fun runSoon(asked: Boolean): Boolean = try {
        val waiting = jobs.getPendingJob(SOON_JOB)
        if (waiting != null && (!asked || waiting.extras.getBoolean(ASKED, false))) {
            true
        } else {
            val job = JobInfo.Builder(SOON_JOB, service)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setExtras(PersistableBundle().apply { putBoolean(ASKED, asked) })
                .build()
            jobs.schedule(job) == JobScheduler.RESULT_SUCCESS
        }
    } catch (_: RuntimeException) {
        false
    }

    override fun cancel() {
        try {
            jobs.cancel(PERIODIC_JOB)
            jobs.cancel(SOON_JOB)
        } catch (_: RuntimeException) {
            // A job that runs once more meets the stopped state and does nothing.
        }
    }

    internal companion object {
        const val PERIODIC_JOB = 1
        const val SOON_JOB = 2

        /** True in the extras of a run the user asked for: **Sync now** or **Try again**. */
        const val ASKED = "asked"

        /** Every 15 minutes, the shortest period Android allows. */
        const val PERIOD_MILLIS: Long = 15 * 60 * 1000L
    }
}

/**
 * The service JobScheduler starts for a run. Only Android can reach it:
 * its manifest entry asks callers for `BIND_JOB_SERVICE`. The run itself
 * is [SyncRun]; Android holds a wake lock while the job runs. Each job
 * keeps its own work, so that Android stopping one job stops only that
 * job's run.
 */
class SyncJobService : JobService() {
    private val running = RunningJobs()

    override fun onStartJob(params: JobParameters): Boolean {
        val sync = (application as? SyncHost)?.sync ?: return false
        val asked = params.extras.getBoolean(JobSchedulerScheduler.ASKED, false)
        val entry = running.begin(params.jobId)
        val job = sync.scope.launch(start = CoroutineStart.LAZY) {
            try {
                sync.run.run(asked) { entry.stopped.get() }
            } finally {
                running.end(params.jobId, entry)
                if (!entry.stopped.get()) jobFinished(params, false)
            }
        }
        entry.job = job
        job.start()
        return true
    }

    /**
     * Android ends the job. Its run stops before its next request or
     * courier call. Everything a run does can stop and go on: the next run
     * continues.
     */
    override fun onStopJob(params: JobParameters): Boolean {
        running.stop(params.jobId)
        return false
    }
}

/**
 * The runs of the jobs that Android started, one for each job ID. A job
 * that Android starts again under the same ID takes the place of the one
 * before, and the end of the older run never removes the newer one.
 */
internal class RunningJobs {
    private val running = ConcurrentHashMap<Int, Entry>()

    /** One job's run: whether Android stopped it, and its work. */
    class Entry {
        val stopped = AtomicBoolean(false)

        @Volatile
        var job: Job? = null
    }

    /** A new run for [jobId]. */
    fun begin(jobId: Int): Entry = Entry().also { running[jobId] = it }

    /** The run [entry] of [jobId] ended. A newer run of the same ID stays. */
    fun end(jobId: Int, entry: Entry) {
        running.remove(jobId, entry)
    }

    /** Android stopped [jobId]: its run stops before its next request. */
    fun stop(jobId: Int) {
        running.remove(jobId)?.let {
            it.stopped.set(true)
            it.job?.cancel()
        }
    }
}
