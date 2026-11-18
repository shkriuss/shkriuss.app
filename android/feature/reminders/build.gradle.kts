plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.compose")
    id("shkriuss.android.unit-test")
    id("shkriuss.android.room")
}

android {
    namespace = "app.shkriuss.feature.reminders"
}

dependencies {
    // The app class builds RemindersServices with the Clock and the IdSource
    // of core/data, so the module shows core/data to the app.
    api(project(":core:data"))
    // Reminders' records in a backup (RemindersBackupContent). It also
    // brings AppName of core/crypto, the name of the app in keys and
    // backups (RemindersServices.APP_NAME).
    implementation(project(":core:backup"))
    implementation(libs.lifecycle.viewmodel)
    // The screens: the Shk* components, and BackHandler from Activity
    // Compose, which the app has already. No navigation library: Reminders
    // has three destinations and one open form, as Water has three
    // destinations and one open day (ADR 0003, point 2).
    implementation(project(":core:design"))
    implementation(libs.activity.compose)

    testImplementation(project(":core:testing"))
    // Real keys for the backup round trip, where no Android Keystore
    // exists (ADR 0029). Test fixtures are never part of an app.
    testImplementation(testFixtures(project(":core:crypto")))
}
