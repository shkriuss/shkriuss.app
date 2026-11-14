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

    // The check that every screen of an app is behind the app lock
    // (AppLockCheck). Compile only: the app's own unit tests bring these at
    // run time, so the tests on an emulator that use this module get none
    // of them (docs/development/build.md, "Shared test helpers").
    // Activity Compose comes before the Compose test library on purpose:
    // then the newer AndroidX versions are chosen first, and Gradle never
    // reads the metadata of the old ones that androidx.test:core 1.5.0 asks
    // for, which dependency verification does not know.
    compileOnly(project(":core:security"))
    compileOnly(testFixtures(project(":core:crypto")))
    compileOnly(platform(libs.compose.bom))
    compileOnly(libs.activity.compose)
    compileOnly(libs.compose.ui.test.junit4)
    constraints {
        // As the Compose convention plugin does for tests: the Espresso the
        // Compose test library asks for is 3.5, and lint would read its old
        // metadata, which dependency verification does not know.
        compileOnly(libs.espresso.core)
    }
}
