package app.shkriuss.core.notify

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * No module but `core/notify` uses Android's alarms or notifications
 * (CLAUDE.md, "Alarms and notifications only through `core/notify`", and
 * ADR 0010).
 *
 * The test reads the source of every other module under `android/`. It
 * reads the whole text of each file, so a name that is written out in
 * full without an import is caught too. A comment that names one of them
 * fails as well: word it differently.
 */
class NotifyBoundaryTest {
    /** The folder `android/`, found from wherever Gradle runs the test. */
    private val androidFolder: File = generateSequence(File("").absoluteFile) { it.parentFile }
        .first { File(it, "settings.gradle.kts").isFile && File(it, "build-logic").isDirectory }

    private val thisModule = File(androidFolder, "core/notify")

    private fun sourcesIn(folder: File): List<File> = folder.walkTopDown()
        .onEnter { it.name !in SKIPPED_FOLDERS }
        .filter { it.isFile && it.extension in SOURCE_ENDINGS }
        .toList()

    @Test
    fun noOtherModuleUsesAlarmsOrNotifications() {
        val sources = sourcesIn(androidFolder).filterNot { it.startsWith(thisModule) }
        assertTrue("the test must read the other modules, and found only ${sources.size} files", sources.size >= 50)
        listOf("core/backup", "core/crypto", "core/data", "core/design", "core/testing", "app/catalog").forEach { module ->
            assertTrue("no source of $module was read", sources.any { it.startsWith(File(androidFolder, module)) })
        }

        val problems = sources.flatMap { file ->
            problemsIn(file.readText()).map { "${file.relativeTo(androidFolder).invariantSeparatorsPath}: $it" }
        }

        assertEquals(
            "Alarms and notifications only through core/notify (CLAUDE.md). " +
                "Use what core/notify offers, or stop and ask the owner.",
            emptyList<String>(),
            problems,
        )
    }

    @Test
    fun thisModuleItselfWouldNotPass() {
        // The check is not blind: the one module that may use both trips it.
        val found = sourcesIn(File(thisModule, "src/main")).flatMap { problemsIn(it.readText()) }.toSet()

        assertEquals(setOf("names android.app.AlarmManager", "names android.app.Notification"), found)
    }

    @Test
    fun whatTheCheckFinds() {
        val forbidden = mapOf(
            "import android.app.AlarmManager" to "names android.app.AlarmManager",
            "import android.app.AlarmManager as Alarms" to "names android.app.AlarmManager",
            "val alarms = getSystemService(android.app.AlarmManager::class.java)" to "names android.app.AlarmManager",
            "import android.app.Notification" to "names android.app.Notification",
            "import android.app.NotificationManager" to "names android.app.Notification",
            "import android.app.NotificationChannel" to "names android.app.Notification",
            "import android.app.NotificationChannelGroup" to "names android.app.Notification",
            "android.app.Notification.Builder(context, channel)" to "names android.app.Notification",
            "import androidx.core.app.NotificationCompat" to "names androidx.core.app.Notification",
            "import androidx.core.app.NotificationManagerCompat" to "names androidx.core.app.Notification",
            "import androidx.core.app.AlarmManagerCompat" to "names androidx.core.app.AlarmManagerCompat",
            "import android.app.*" to "imports android.app.* with a star",
            "import  android.app.*  // everything" to "imports android.app.* with a star",
            "import androidx.core.app.*" to "imports androidx.core.app.* with a star",
            "val alarms = context.getSystemService(Context.ALARM_SERVICE)" to "asks for the alarm or notification service by name",
            "getSystemService(NOTIFICATION_SERVICE)" to "asks for the alarm or notification service by name",
        )
        forbidden.forEach { (line, problem) -> assertEquals(line, listOf(problem), problemsIn("package a\n\n$line\n")) }

        val allowed = listOf(
            "import android.app.Activity",
            "import android.app.Application",
            "import android.app.PendingIntent",
            "import app.shkriuss.core.notify.Notify",
            "import app.shkriuss.core.notify.Notifications",
            "import app.shkriuss.core.notify.ShkNotification",
            "notify.notifications.show(reminder)",
            "val state = notify.state(channel)",
        )
        allowed.forEach { line -> assertEquals(line, emptyList<String>(), problemsIn("package a\n\n$line\n")) }
    }

    /** What is wrong with one source file, as a list of short sentences. Empty if nothing is. */
    private fun problemsIn(text: String): List<String> = buildList {
        NAMES.forEach { name -> if (name in text) add("names $name") }
        STAR_IMPORTS.forEach { (packageName, pattern) -> if (pattern.containsMatchIn(text)) add("imports $packageName.* with a star") }
        if (SERVICE_NAME.containsMatchIn(text)) add("asks for the alarm or notification service by name")
    }

    private companion object {
        val SOURCE_ENDINGS = setOf("kt", "kts", "java")
        val SKIPPED_FOLDERS = setOf("build", ".gradle", ".kotlin", ".git")

        /** The second name covers every class of `android.app` whose name starts with it. */
        val NAMES = listOf(
            "android.app.AlarmManager",
            "android.app.Notification",
            "androidx.core.app.Notification",
            "androidx.core.app.AlarmManagerCompat",
        )

        /** With a star import, the classes could be used without their full names anywhere in the file. */
        val STAR_IMPORTS = listOf("android.app", "androidx.core.app").associateWith { packageName ->
            Regex("""import\s+${Regex.escape(packageName)}\.\*""")
        }

        /** The other way to reach a system service: by the name of the service. */
        val SERVICE_NAME = Regex("""\b(ALARM_SERVICE|NOTIFICATION_SERVICE)\b""")
    }
}
