plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.compose")
    id("shkriuss.android.unit-test")
}

android {
    namespace = "app.shkriuss.core.design"
}

dependencies {
    // Only this module may use Material 3 (CLAUDE.md, architecture rules).
    api(libs.compose.ui)
    api(libs.compose.foundation)
    implementation(libs.compose.material3)
    // For the back gesture in ShkListDetailScaffold. Material 3 already
    // brings it at run time; the apps use the same version.
    implementation(libs.activity.compose)
}
