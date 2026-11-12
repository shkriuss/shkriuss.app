# R8 rules for the release and preview build types of every app.
# See docs/development/build.md, "R8".
#
# Owner decisions on pull request 5: shrink and optimise, but never rename.
# - The code is public, so renaming hides nothing.
# - There is no crash reporter, so users paste stack traces. With real
#   class and method names, a pasted trace says where it failed.

# Keep the names of classes, methods and fields.
# The APK rules check depends on this: it finds classes of Google Play
# services in a release APK by their real names (CheckApkRulesTask.kt, and
# docs/development/build.md, "APK rules check"). Never remove it without
# changing that check.
-dontobfuscate

# No app may hold a class of Google Play services (hard rule 3). The APK
# rules check finds such a class by its name. "Never rename" is not enough
# for that: R8 can fold a class into another one, and then the name is gone
# while the code stays. With this rule, a Play services class that reaches
# an app keeps its name, so the check sees it and fails the build. In a
# correct app the rule matches nothing and changes nothing. The owner asked
# for it on pull request 25.
-keep class com.google.android.gms.** { *; }

# The test fixtures of core/crypto must never be in an app (ADR 0029).
# The APK rules check finds them by their class names. Without this rule
# R8 can fold such a class into another one: the name is gone and the code
# stays. That is what happened when the check was first tried on a release
# APK. With this rule, a fixture class that reaches an app keeps its name,
# so the check sees it and fails the build. In a correct app the rule
# matches nothing and changes nothing.
-keep class app.shkriuss.core.crypto.fixtures.** { *; }

# Keep the source file and line number attributes. While R8 optimises,
# stack traces show the source file as "r8-map-id-..." and line numbers as
# instruction offsets. With these attributes kept, the release's mapping
# file can turn such a trace back into exact files and lines. Without them,
# that information would be lost for good.
-keepattributes SourceFile,LineNumberTable
