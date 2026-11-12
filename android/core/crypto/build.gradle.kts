plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.unit-test")
    id("shkriuss.android.instrumented-test")
}

android {
    namespace = "app.shkriuss.core.crypto"
}

dependencies {
    // Tink is the only cryptography library (ADR 0006). It is an
    // implementation dependency, so no other module can call it, and no
    // Tink type is part of what this module shows to others.
    implementation(libs.tink.android)
}
