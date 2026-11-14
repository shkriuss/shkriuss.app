plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.unit-test")
    id("shkriuss.android.instrumented-test")
    id("shkriuss.android.test-fixtures")
}

android {
    namespace = "app.shkriuss.core.notify"
}

dependencies {
    // Notify takes the Clock of core/data, so it shows it to the modules
    // that use it. Nothing else: alarms and notifications are Android's
    // own AlarmManager and NotificationManager.
    api(project(":core:data"))

    testImplementation(project(":core:testing"))

    // The test fixtures (NotifyTestDevice): what an app's tests check of
    // its alarms and notifications on Robolectric's Android, so that no
    // other module names Android's alarm or notification classes, not even
    // in its tests (NotifyBoundaryTest). Compile only: the tests that use
    // the fixtures bring Robolectric themselves (the unit-test plugin).
    testFixturesCompileOnly(libs.robolectric)
}
