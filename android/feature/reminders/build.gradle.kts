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
    // Backup and restore: Reminders' records in a backup
    // (RemindersBackupContent), and Backups, which writes, checks and
    // restores the file the user picks. It also brings AppName of
    // core/crypto, the name of the app in keys and backups
    // (RemindersServices.APP_NAME).
    implementation(project(":core:backup"))
    // The notifications: Reminders' AlarmSource, AlarmHandler and
    // ButtonHandler, and the state of the notification permission. Alarms
    // and notifications only through core/notify (CLAUDE.md).
    implementation(project(":core:notify"))
    implementation(libs.lifecycle.viewmodel)
    // The screens: the Shk* components, and BackHandler from Activity
    // Compose, which the app has already. No navigation library: Reminders
    // has three destinations and one open form, as Water has three
    // destinations and one open day (ADR 0003, point 2).
    implementation(project(":core:design"))
    // The recovery key and the app lock: Settings opens the screens of
    // core/security through SecurityScreens, and shows its dialog for the
    // moment the recovery key is first needed (ADR 0035). It comes after
    // core/design, as in the build files of the apps.
    implementation(project(":core:security"))
    implementation(libs.activity.compose)

    testImplementation(project(":core:testing"))
    // What the notifications show and which alarms wait, on Robolectric's
    // Android, without naming Android's alarm or notification classes.
    testImplementation(testFixtures(project(":core:notify")))
    // Real keys for the backup round trip, where no Android Keystore
    // exists (ADR 0029). Test fixtures are never part of an app.
    testImplementation(testFixtures(project(":core:crypto")))
}
