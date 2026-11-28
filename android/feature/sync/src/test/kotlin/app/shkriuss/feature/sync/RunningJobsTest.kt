package app.shkriuss.feature.sync

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The runs of the job service, one for each job ID (`SyncJobService`). */
class RunningJobsTest {
    @Test
    fun theEndOfAnOlderRunDoesNotForgetANewerRunOfTheSameJob() {
        val jobs = RunningJobs()
        val older = jobs.begin(2)
        val newer = jobs.begin(2)
        jobs.end(2, older)
        jobs.stop(2)
        assertTrue("Android stops the newer run", newer.stopped.get())
        assertFalse(older.stopped.get())
    }

    @Test
    fun stoppingOneJobLeavesTheOther() {
        val jobs = RunningJobs()
        val periodic = jobs.begin(1)
        val soon = jobs.begin(2)
        jobs.stop(1)
        assertTrue(periodic.stopped.get())
        assertFalse(soon.stopped.get())
    }
}
