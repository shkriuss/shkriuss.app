plugins {
    id("shkriuss.android.application")
    id("shkriuss.android.compose")
    id("shkriuss.android.screenshot-test")
}

android {
    namespace = "app.shkriuss.water"

    defaultConfig {
        applicationId = "app.shkriuss.water"
        // Not released yet. Step 2.6 sets 1.0.0. The code follows from the
        // name by the rule in ADR 0021, and CI checks it.
        versionCode = 10000101
        versionName = "1.0.0-alpha.1"
    }
}

dependencies {
    implementation(project(":feature:water"))
    implementation(project(":core:design"))
    // The app lock: SecurityHost, AppLockWatcher and AppLockGate. Until
    // step 2.5 the manifest removes the module's two permissions and its
    // six screens (docs/security/permissions.md).
    implementation(project(":core:security"))
    implementation(libs.activity.compose)

    // The check that every screen of the app is behind the app lock
    // (docs/architecture/security-screens.md, "Every screen is behind the
    // gate"), and its app classes, which need real keys on the stand-in
    // for the Keystore (ADR 0029). Test fixtures are never part of an app.
    testImplementation(project(":core:testing"))
    testImplementation(testFixtures(project(":core:crypto")))
}
