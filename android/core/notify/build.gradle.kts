plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.unit-test")
    id("shkriuss.android.instrumented-test")
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
}
