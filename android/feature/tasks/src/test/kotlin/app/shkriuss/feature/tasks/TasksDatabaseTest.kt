package app.shkriuss.feature.tasks

import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.testing.MigrationTestRule
import app.shkriuss.feature.tasks.data.TasksDatabase
import app.shkriuss.feature.tasks.data.TasksMigrations
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The schema of `tasks.db`, from its committed schema files. Version 1
 * has no migration yet. When version 2 comes, a test for the step 1 to 2
 * joins these, as in `SampleMigrationTest` of core/data
 * (docs/architecture/data.md, "Migration tests").
 */
@RunWith(RobolectricTestRunner::class)
class TasksDatabaseTest {
    @get:Rule
    val migrations = MigrationTestRule(InstrumentationRegistry.getInstrumentation(), TasksDatabase::class)

    @Test
    fun theNewestSchemaFollowsTheRecordConventions() {
        migrations.checkNewestFollowsRecordConventions()
    }

    @Test
    fun everyVersionMigratesToTheNewest() {
        migrations.checkEveryVersionMigratesToNewest(TasksMigrations.All)
    }
}
