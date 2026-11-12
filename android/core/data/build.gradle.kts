plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.unit-test")
    id("shkriuss.android.room")
}

android {
    namespace = "app.shkriuss.core.data"
}

dependencies {
    // RecordDao, RecordWriter and systemSqliteDatabaseBuilder show Room and
    // the system SQLite driver to the modules that use them.
    api(libs.room.runtime)
    api(libs.sqlite.framework)

    // The sample database in the unit tests.
    kspTest(libs.room.compiler)
    testImplementation(project(":core:testing"))
}
