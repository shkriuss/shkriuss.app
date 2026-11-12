plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.unit-test")
}

android {
    namespace = "app.shkriuss.core.testing"
}

dependencies {
    // Shared test helpers. Modules use this only in their tests.
    api(project(":core:data"))
    api(libs.junit)
    api(libs.room.runtime)
    implementation(libs.room.testing)
    implementation(libs.sqlite.framework)
}
