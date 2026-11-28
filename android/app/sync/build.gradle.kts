plugins {
    id("shkriuss.android.application")
    id("shkriuss.android.compose")
    id("shkriuss.android.screenshot-test")
}

android {
    namespace = "app.shkriuss.sync"

    defaultConfig {
        applicationId = "app.shkriuss.sync"
        // Not released yet. Follows from versionName by the rule in ADR 0021. CI checks it.
        versionCode = 10000101
        versionName = "1.0.0-alpha.1"
    }
}

dependencies {
    // core/design comes before feature/sync, as in Water's build file:
    // with the feature first, Gradle reads the metadata of an old Compose UI
    // before the Compose BOM settles the version.
    implementation(project(":core:design"))
    // Everything of Sync but its screens: the state, the server, the
    // couriers of the data apps, the run, the join, the devices, Sync's
    // own courier provider and its JobScheduler service.
    implementation(project(":feature:sync"))
    // ShkCrypto for the app name sync, with the device key and the name key.
    implementation(project(":core:crypto"))
    // feature/sync uses core/security for "Sign a device" and the check of
    // the data apps. Named here too, so that the manifest's removals of
    // that module's screens, provider and permissions find their classes.
    // It comes after core/design, as in the build files of the apps.
    implementation(project(":core:security"))
    implementation(libs.activity.compose)

    // The manifest test reads the merged manifest; the app class of the
    // tests needs real keys on the stand-in for the Keystore (ADR 0029).
    // Test fixtures are never part of an app.
    testImplementation(project(":core:testing"))
    testImplementation(testFixtures(project(":core:crypto")))
}
