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
    implementation(libs.lifecycle.viewmodel)
    // The screens: the Shk* components, and BackHandler from Activity
    // Compose, which the app has already. No navigation library: Tasks has
    // three destinations, one open list and a form, as Water has three
    // destinations and one open day (ADR 0003, point 2).
    implementation(project(":core:design"))
    implementation(libs.activity.compose)

    testImplementation(project(":core:testing"))
}
