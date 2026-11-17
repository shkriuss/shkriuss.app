package app.shkriuss.feature.reminders

import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.testing.MigrationTestRule
import app.shkriuss.feature.reminders.data.RemindersDatabase
import app.shkriuss.feature.reminders.data.RemindersMigrations
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The schema of `reminders.db`, from its committed schema files. Version 1
 * has no migration yet. When version 2 comes, a test for the step 1 to 2
 * joins these, as in `SampleMigrationTest` of core/data
 * (docs/architecture/data.md, "Migration tests").
 */
@RunWith(RobolectricTestRunner::class)
class RemindersDatabaseTest {
    @get:Rule
    val migrations = MigrationTestRule(InstrumentationRegistry.getInstrumentation(), RemindersDatabase::class)

    @Test
    fun theNewestSchemaFollowsTheRecordConventions() {
        migrations.checkNewestFollowsRecordConventions()
    }

    @Test
    fun everyVersionMigratesToTheNewest() {
        migrations.checkEveryVersionMigratesToNewest(RemindersMigrations.All)
    }
}
