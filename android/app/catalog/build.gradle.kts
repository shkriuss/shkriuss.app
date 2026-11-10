plugins {
    id("shkriuss.android.application")
    id("shkriuss.android.compose")
    id("shkriuss.android.screenshot-test")
}

android {
    namespace = "app.shkriuss.catalog"

    defaultConfig {
        applicationId = "app.shkriuss.catalog"
        versionCode = 1
        versionName = "0.1.0"
    }
}

dependencies {
    implementation(project(":core:design"))
    implementation(libs.activity.compose)
}
