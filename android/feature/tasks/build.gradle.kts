plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.compose")
    id("shkriuss.android.unit-test")
    id("shkriuss.android.room")
}

android {
    namespace = "app.shkriuss.feature.tasks"
}

dependencies {
    // The app class builds TasksServices with the Clock and the IdSource of
    // core/data, so the module shows core/data to the app.
    api(project(":core:data"))
    // AppName of core/crypto: the name of the app in keys and backups
    // (TasksServices.APP_NAME). The app class makes its ShkCrypto with it.
    implementation(project(":core:crypto"))
    // The reminders: Tasks' AlarmSource, AlarmHandler, ButtonHandler and
    // ShownReview, and the state of the notification permission. Alarms
    // and notifications only through core/notify (CLAUDE.md).
    implementation(project(":core:notify"))
    implementation(libs.lifecycle.viewmodel)
    // The screens: the Shk* components, and BackHandler from Activity
    // Compose, which the app has already. No navigation library: Tasks has
    // three destinations, one open list and a form, as Water has three
    // destinations and one open day (ADR 0003, point 2).
    implementation(project(":core:design"))
    implementation(libs.activity.compose)

    testImplementation(project(":core:testing"))
    // What the notifications show and which alarms wait, on Robolectric's
    // Android, without naming Android's alarm or notification classes.
    testImplementation(testFixtures(project(":core:notify")))
}
