plugins {
    id("shkriuss.android.library")
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

    testImplementation(project(":core:testing"))
}
