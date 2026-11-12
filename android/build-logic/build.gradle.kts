import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinVersion

plugins {
    `java-gradle-plugin`
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.sam.with.receiver)
}

// Lets `Action<T>` blocks use `this`, as in normal Gradle build scripts.
samWithReceiver {
    annotation("org.gradle.api.HasImplicitReceiver")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        allWarningsAsErrors = true
        jvmTarget = JvmTarget.JVM_17
        // Gradle 9.6 runs plugins with its own Kotlin 2.3 standard library.
        apiVersion = KotlinVersion.KOTLIN_2_3
        languageVersion = KotlinVersion.KOTLIN_2_3
    }
}

dependencies {
    compileOnly(gradleKotlinDsl())
    implementation(libs.android.gradle.plugin)
    implementation(libs.kotlin.gradle.plugin)
    implementation(libs.compose.compiler.gradle.plugin)
    implementation(libs.roborazzi.gradle.plugin)
    implementation(libs.room.gradle.plugin)
    implementation(libs.ksp.gradle.plugin)
}

gradlePlugin {
    plugins {
        register("androidApplication") {
            id = "shkriuss.android.application"
            implementationClass = "app.shkriuss.buildlogic.AndroidApplicationConventionPlugin"
        }
        register("androidLibrary") {
            id = "shkriuss.android.library"
            implementationClass = "app.shkriuss.buildlogic.AndroidLibraryConventionPlugin"
        }
        register("androidCompose") {
            id = "shkriuss.android.compose"
            implementationClass = "app.shkriuss.buildlogic.AndroidComposeConventionPlugin"
        }
        register("androidUnitTest") {
            id = "shkriuss.android.unit-test"
            implementationClass = "app.shkriuss.buildlogic.AndroidUnitTestConventionPlugin"
        }
        register("androidScreenshotTest") {
            id = "shkriuss.android.screenshot-test"
            implementationClass = "app.shkriuss.buildlogic.AndroidScreenshotTestConventionPlugin"
        }
        register("androidInstrumentedTest") {
            id = "shkriuss.android.instrumented-test"
            implementationClass = "app.shkriuss.buildlogic.AndroidInstrumentedTestConventionPlugin"
        }
        register("androidRoom") {
            id = "shkriuss.android.room"
            implementationClass = "app.shkriuss.buildlogic.AndroidRoomConventionPlugin"
        }
    }
}
