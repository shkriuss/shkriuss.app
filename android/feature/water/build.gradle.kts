plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.unit-test")
    id("shkriuss.android.room")
}

android {
    namespace = "app.shkriuss.feature.water"
}

dependencies {
    // The app class builds WaterServices with the Clock and the IdSource of
    // core/data, so the module shows core/data to the app.
    api(project(":core:data"))
    // Water's records in a backup (WaterBackupContent). The screens of
    // backup and restore come in step 2.5.
    implementation(project(":core:backup"))
    implementation(libs.lifecycle.viewmodel)

    testImplementation(project(":core:testing"))
    // Real keys for the backup round trip, where no Android Keystore
    // exists (ADR 0029). Test fixtures are never part of an app.
    testImplementation(testFixtures(project(":core:crypto")))
}
