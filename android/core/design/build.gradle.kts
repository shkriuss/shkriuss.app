plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.compose")
}

android {
    namespace = "app.shkriuss.core.design"
}

dependencies {
    // Only this module may use Material 3 (CLAUDE.md, architecture rules).
    api(libs.compose.ui)
    api(libs.compose.foundation)
    implementation(libs.compose.material3)
}
