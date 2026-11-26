plugins {
    id("shkriuss.android.application")
    id("shkriuss.android.compose")
    id("shkriuss.android.screenshot-test")
}

android {
    namespace = "app.shkriuss.notes"

    defaultConfig {
        applicationId = "app.shkriuss.notes"
        // Follows from versionName by the rule in ADR 0021. CI checks it.
        versionCode = 10000900
        versionName = "1.0.0"
    }
}

dependencies {
    // core/design comes before feature/notes, as in Water's build file:
    // with the feature first, Gradle reads the metadata of an old Compose UI
    // before the Compose BOM settles the version.
    implementation(project(":core:design"))
    implementation(project(":feature:notes"))
    // The app lock: SecurityHost, AppLockWatcher and AppLockGate. The
    // module adds two permissions, eight screens and a status provider.
    // Only the handover screen and the status provider are exported, and
    // each checks the calling app first (ADR 0041,
    // docs/security/permissions.md).
    implementation(project(":core:security"))
    implementation(libs.activity.compose)

    // The check that every screen of the app is behind the app lock
    // (docs/architecture/security-screens.md, "Every screen is behind the
    // gate"), and its app classes, which need real keys on the stand-in
    // for the Keystore (ADR 0029). Test fixtures are never part of an app.
    testImplementation(project(":core:testing"))
    testImplementation(testFixtures(project(":core:crypto")))
    // Backups that Notes does not take, written as another app, other
    // recovery words or a newer version would write them, for the
    // screenshots of the answers. A module of this project, not a library.
    testImplementation(project(":core:backup"))
}
