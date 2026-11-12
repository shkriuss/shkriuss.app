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

# Keep the source file and line number attributes. While R8 optimises,
# stack traces show the source file as "r8-map-id-..." and line numbers as
# instruction offsets. With these attributes kept, the release's mapping
# file can turn such a trace back into exact files and lines. Without them,
# that information would be lost for good.
-keepattributes SourceFile,LineNumberTable
