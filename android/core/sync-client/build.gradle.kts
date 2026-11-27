plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.unit-test")
    id("shkriuss.android.room")
}

android {
    namespace = "app.shkriuss.core.sync"
}

dependencies {
    // The sealed record holds a backup's record entry, so SyncContent shows
    // BackupRecord of core/backup, and with it KeyId and RecordSealer of
    // core/crypto and RoomDatabase, RecordFields and Clock of core/data.
    api(project(":core:backup"))

    // The test database, with record tables of a made-up app and the sync tables.
    kspTest(libs.room.compiler)
    testImplementation(project(":core:testing"))
    // Real keys for the unit tests, where no Android Keystore exists
    // (ADR 0029). Test fixtures are never part of an app.
    testImplementation(testFixtures(project(":core:crypto")))
}
