plugins {
    id("shkriuss.android.application")
    id("shkriuss.android.compose")
    id("shkriuss.android.screenshot-test")
}

android {
    namespace = "app.shkriuss.water"

    defaultConfig {
        applicationId = "app.shkriuss.water"
        // Follows from versionName by the rule in ADR 0021. CI checks it.
        versionCode = 10001900
        versionName = "1.0.1"
    }
}

dependencies {
    // core/design comes before feature/water on purpose. With feature/water
    // first, Gradle reads the metadata of an old Compose UI (1.0.1, asked
    // for by Activity Compose) before the Compose BOM settles the version,
    // and dependency verification refuses it. The versions resolved are the
    // same either way.
    implementation(project(":core:design"))
    implementation(project(":feature:water"))
    // Reminders: the app class is a NotifyHost and builds the one
    // Notify. The module adds three permissions and three receivers, none
    // exported (docs/security/permissions.md).
    implementation(project(":core:notify"))
    // The recovery key and the app lock: SecurityHost, AppLockWatcher and
    // AppLockGate. The module adds two permissions and six screens, none
    // exported (docs/security/permissions.md).
    implementation(project(":core:security"))
    implementation(libs.activity.compose)

    // The check that every screen of the app is behind the app lock
    // (docs/architecture/security-screens.md, "Every screen is behind the
    // gate"), and its app classes, which need real keys on the stand-in
    // for the Keystore (ADR 0029). Test fixtures are never part of an app.
    testImplementation(project(":core:testing"))
    // What the reminders show and which alarms wait, on Robolectric's
    // Android, without naming Android's alarm or notification classes.
    testImplementation(testFixtures(project(":core:notify")))
    testImplementation(testFixtures(project(":core:crypto")))
}
