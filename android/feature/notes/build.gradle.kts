plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.compose")
    id("shkriuss.android.unit-test")
    id("shkriuss.android.room")
}

android {
    namespace = "app.shkriuss.feature.notes"
}

dependencies {
    // The app class builds NotesServices with the Clock and the IdSource of
    // core/data, so the module shows core/data to the app.
    api(project(":core:data"))
    // The files: FileCrypto makes and seals the key of each file and
    // encrypts its stream, and KeySetup says when the file keys move to the
    // recovery key (docs/apps/notes/spec.md, "Files"). Also AppName, the
    // name of the app in keys and backups (NotesServices.APP_NAME). The
    // app class makes its ShkCrypto with it. Cryptography only through
    // core/crypto (CLAUDE.md).
    implementation(project(":core:crypto"))
    implementation(libs.lifecycle.viewmodel)
    // The screens: the Shk* components, and BackHandler and the launchers
    // of the system file picker from Activity Compose, which the app has
    // already. No navigation library: Notes has two destinations, one open
    // note and its image view, as Tasks has three destinations and one open
    // list (ADR 0003, point 2).
    implementation(project(":core:design"))
    implementation(libs.activity.compose)

    testImplementation(project(":core:testing"))
    // Real keys for the files, where no Android Keystore exists (ADR 0029).
    // Test fixtures are never part of an app.
    testImplementation(testFixtures(project(":core:crypto")))
}
