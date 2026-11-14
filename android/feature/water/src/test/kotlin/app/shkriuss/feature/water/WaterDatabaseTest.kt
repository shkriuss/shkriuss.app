package app.shkriuss.feature.water

import androidx.test.platform.app.InstrumentationRegistry
import app.shkriuss.core.testing.MigrationTestRule
import app.shkriuss.feature.water.data.WaterDatabase
import app.shkriuss.feature.water.data.WaterMigrations
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The schema of `water.db`, from its committed schema files. Version 1
 * has no migration yet. When version 2 comes, a test for the step 1 to 2
 * joins these, as in `SampleMigrationTest` of core/data
 * (docs/architecture/data.md, "Migration tests").
 */
@RunWith(RobolectricTestRunner::class)
class WaterDatabaseTest {
    @get:Rule
    val migrations = MigrationTestRule(InstrumentationRegistry.getInstrumentation(), WaterDatabase::class)

    @Test
    fun theNewestSchemaFollowsTheRecordConventions() {
        migrations.checkNewestFollowsRecordConventions()
    }

    @Test
    fun everyVersionMigratesToTheNewest() {
        migrations.checkEveryVersionMigratesToNewest(WaterMigrations.All)
    }
}
