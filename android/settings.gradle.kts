// The shkriuss.app Gradle build. See docs/development/build.md.
//
// Repositories: Google's Maven repository and Maven Central only.
// Modules may not declare their own repositories.

pluginManagement {
    includeBuild("build-logic")
    repositories {
        google {
            content {
                includeGroupByRegex("androidx(\\..*)?")
                includeGroupByRegex("com\\.android(\\..*)?")
                includeGroupByRegex("com\\.google(\\..*)?")
            }
        }
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        google {
            content {
                includeGroupByRegex("androidx(\\..*)?")
                includeGroupByRegex("com\\.android(\\..*)?")
                includeGroupByRegex("com\\.google(\\..*)?")
            }
        }
        mavenCentral()
    }
}

rootProject.name = "shkriuss"

include(":core:design")
include(":core:data")
include(":core:crypto")
include(":core:backup")
include(":core:notify")
include(":core:testing")
include(":app:catalog")
