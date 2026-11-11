plugins {
    id("shkriuss.android.application")
    id("shkriuss.android.compose")
    id("shkriuss.android.screenshot-test")
}

android {
    namespace = "app.shkriuss.catalog"

    defaultConfig {
        applicationId = "app.shkriuss.catalog"
        // Follows from versionName by the rule in ADR 0021. CI checks it.
        versionCode = 100900
        versionName = "0.1.0"
    }
}

dependencies {
    implementation(project(":core:design"))
    implementation(libs.activity.compose)
}
