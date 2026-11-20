plugins {
    id("shkriuss.android.application")
    id("shkriuss.android.compose")
    id("shkriuss.android.screenshot-test")
}

android {
    namespace = "app.shkriuss.reminders"

    defaultConfig {
        applicationId = "app.shkriuss.reminders"
        // Follows from versionName by the rule in ADR 0021. CI checks it.
        versionCode = 10000900
        versionName = "1.0.0"
    }
}

dependencies {
    // core/design comes before feature/reminders, as in Water's build file:
    // with the feature first, Gradle reads the metadata of an old Compose UI
    // before the Compose BOM settles the version.
    implementation(project(":core:design"))
    implementation(project(":feature:reminders"))
    // The notifications: the app class is a NotifyHost and builds the one
    // Notify. The module adds three permissions and three receivers, none
    // exported (docs/security/permissions.md).
    implementation(project(":core:notify"))
    // The app lock: SecurityHost, AppLockWatcher and AppLockGate. The
    // module adds two permissions and six screens, none exported
    // (docs/security/permissions.md).
    implementation(project(":core:security"))
    implementation(libs.activity.compose)

    // The check that every screen of the app is behind the app lock
    // (docs/architecture/security-screens.md, "Every screen is behind the
    // gate"), and its app classes, which need real keys on the stand-in
    // for the Keystore (ADR 0029). Test fixtures are never part of an app.
    testImplementation(project(":core:testing"))
    // What the notifications show and which alarms wait, on Robolectric's
    // Android, without naming Android's alarm or notification classes.
    testImplementation(testFixtures(project(":core:notify")))
    testImplementation(testFixtures(project(":core:crypto")))
}
