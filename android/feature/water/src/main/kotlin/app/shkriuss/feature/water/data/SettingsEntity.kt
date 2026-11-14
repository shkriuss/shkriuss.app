package app.shkriuss.feature.water.data

import androidx.room3.Dao
import androidx.room3.Embedded
import androidx.room3.Entity
import androidx.room3.Index
import androidx.room3.Query
import app.shkriuss.core.data.Record
import app.shkriuss.core.data.RecordDao
import app.shkriuss.core.data.RecordFields
import app.shkriuss.core.data.RecordSql
import kotlinx.coroutines.flow.Flow

/**
 * The settings that belong to the user's data (table `settings` in
 * docs/apps/water/spec.md, ADR 0036). The one in use is the record that is
 * not deleted and has the latest `updatedAt` ([SettingsRules]). Water
 * never deletes one.
 */
@Entity(
    tableName = SettingsEntity.TABLE,
    primaryKeys = ["id"],
    indices = [Index("changeNumber", unique = true)],
)
data class SettingsEntity(
    @Embedded override val record: RecordFields,
    override val changeNumber: Long,
    /** 0 for millilitres, 1 for US fluid ounces. */
    val unit: Int,
    /** The first quick amount, in millilitres, 1 to 3,000. It is also the amount of a reminder's Drank button. */
    val cup1Ml: Int,
    /** The second quick amount, in millilitres, 1 to 3,000. */
    val cup2Ml: Int,
    /** The third quick amount, in millilitres, 1 to 3,000. */
    val cup3Ml: Int,
    /** True if reminders are on. */
    val remindersOn: Boolean,
    /** How long Water waits between reminders: 30, 45, 60, 90, 120 or 180 minutes. */
    val intervalMinutes: Int,
    /** "From", in minutes after midnight, 0 to 1409. */
    val fromMinute: Int,
    /** "Until", in minutes after midnight, from [fromMinute] + 30 to 1439. */
    val untilMinute: Int,
) : Record<SettingsEntity> {
    override fun withRecord(record: RecordFields, changeNumber: Long): SettingsEntity =
        copy(record = record, changeNumber = changeNumber)

    /** The table's name, which is also the type name in a backup. */
    companion object {
        /** The table name. */
        const val TABLE: String = "settings"
    }
}

/** Reads of the settings records. Only `RecordWriter` writes them. */
@Dao
interface SettingsDao : RecordDao<SettingsEntity> {
    @Query("SELECT * FROM settings WHERE id = :id")
    override suspend fun find(id: String): SettingsEntity?

    @Query("SELECT * FROM settings WHERE " + RecordSql.CHANGED_SINCE)
    override suspend fun changedSince(afterChangeNumber: Long, limit: Int): List<SettingsEntity>

    /** The settings records that are not deleted. */
    @Query("SELECT * FROM settings WHERE deletedAt IS NULL")
    fun observeLive(): Flow<List<SettingsEntity>>

    /** The settings records that are not deleted, once. */
    @Query("SELECT * FROM settings WHERE deletedAt IS NULL")
    suspend fun live(): List<SettingsEntity>

    /** Every stored settings record, deleted ones included, for a backup. */
    @Query("SELECT * FROM settings ORDER BY changeNumber")
    suspend fun all(): List<SettingsEntity>
}
