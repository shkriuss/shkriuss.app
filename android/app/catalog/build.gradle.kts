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
        versionCode = 200900
        versionName = "0.2.0"
    }
}

dependencies {
    implementation(project(":core:design"))
    // The recovery key screens, shown with sample data. Catalog holds no
    // keys: its manifest removes the permission and the screens of the
    // module (docs/security/permissions.md).
    implementation(project(":core:security"))
    implementation(libs.activity.compose)
}
