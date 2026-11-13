plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.compose")
    id("shkriuss.android.unit-test")
}

android {
    namespace = "app.shkriuss.core.security"
}

dependencies {
    // The app class hands out its ShkCrypto through SecurityHost, so the
    // module shows core/crypto to the apps that use it.
    api(project(":core:crypto"))
    implementation(project(":core:design"))
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel)

    // A real ShkCrypto on the stand-in for the Keystore (ADR 0029).
    testImplementation(testFixtures(project(":core:crypto")))
}
