package app.shkriuss.feature.sync

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.PersistableBundle
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
 * is [SyncRun]; Android holds a wake lock while the job runs.
 */
class SyncJobService : JobService() {
    private var job: Job? = null

    override fun onStartJob(params: JobParameters): Boolean {
        val sync = (application as? SyncHost)?.sync ?: return false
        val asked = params.extras.getBoolean(JobSchedulerScheduler.ASKED, false)
        job = sync.scope.launch {
            sync.run.run(asked)
            jobFinished(params, false)
        }
        return true
    }

    /** Android ends the run. Everything a run does can stop and go on: the next run continues. */
    override fun onStopJob(params: JobParameters): Boolean {
        job?.cancel()
        return false
    }
}
