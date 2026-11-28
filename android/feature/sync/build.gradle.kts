plugins {
    id("shkriuss.android.library")
    id("shkriuss.android.unit-test")
}

android {
    namespace = "app.shkriuss.feature.sync"
}

dependencies {
    // The names and layouts of the courier interface, which every data app
    // shares (Courier, StatusLayout, StreamListLayout, ExportedBatch,
    // SyncAppState), and the server's pages and answers to a batch, read
    // as a data app reads them. With it come core/crypto, for the device
    // key, the name key and the setup code (SyncKeys), and the Clock of
    // core/data. Sync holds no records: it uses none of the module's
    // tables, and R8 leaves out what Sync does not reach.
    api(project(":core:sync-client"))
    // The data apps on this phone and the check of each one
    // (courierApps, courierPeer), and "Sign a device" (SignDeviceCall,
    // signingApps).
    implementation(project(":core:security"))

    testImplementation(project(":core:testing"))
    // Real keys for the unit tests, where no Android Keystore exists
    // (ADR 0029): the device key, the name key and a data app that signs a
    // join. Test fixtures are never part of an app.
    testImplementation(testFixtures(project(":core:crypto")))
}
