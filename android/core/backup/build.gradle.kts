plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.unit-test")
}

android {
    namespace = "app.shkriuss.core.backup"
}

dependencies {
    // Backups shows BackupCrypto, AppName and KeyId of core/crypto, and
    // RecordFields and Clock of core/data, to the modules that use it.
    api(project(":core:crypto"))
    api(project(":core:data"))

    testImplementation(project(":core:testing"))
    // Real keys for the unit tests, where no Android Keystore exists
    // (ADR 0029). Test fixtures are never part of an app.
    testImplementation(testFixtures(project(":core:crypto")))
}
