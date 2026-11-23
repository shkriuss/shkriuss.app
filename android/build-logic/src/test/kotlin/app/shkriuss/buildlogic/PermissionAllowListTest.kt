package app.shkriuss.buildlogic

import java.io.ByteArrayInputStream
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Document

/**
 * Shows that rule 4 of the APK rules check
 * ([CheckApkRulesTask.permissionProblems]) passes an app's merged manifest
 * that requests only the permissions on that app's allow list, and fails,
 * naming the permission, for every other permission: one that is not on
 * the list, one of another app's list, and one declared rather than
 * requested. The owner asked for the per-app allow list in step 2.4, with
 * the three permissions of core/notify for Water, and in step 2.5 for the
 * two of core/security.
 */
class PermissionAllowListTest {
    /** Water's allow list. Written out here, so a longer list in the check fails a test. */
    private val water = listOf(
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.USE_EXACT_ALARM",
        "android.permission.RECEIVE_BOOT_COMPLETED",
        "android.permission.USE_BIOMETRIC",
        "android.permission.HIDE_OVERLAY_WINDOWS",
    )

    /** Reminders' allow list: the same five as Water's (docs/apps/reminders/spec.md, "Permissions"). */
    private val reminders = water

    /** Tasks' allow list: the same five as Water's (docs/apps/tasks/spec.md, "As in Water and Reminders", permissions). */
    private val tasks = water

    /** A merged manifest with one element per entry of [tags]: the tag and its `android:name`. */
    private fun manifest(vararg tags: Pair<String, String>): Document {
        val body = tags.joinToString("\n") { (tag, name) -> """    <$tag android:name="$name" />""" }
        val xml = """
            <manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.shkriuss.test">
            $body
                <application />
            </manifest>
        """.trimIndent()
        val factory = DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = true
            setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
            setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        }
        return factory.newDocumentBuilder().parse(ByteArrayInputStream(xml.toByteArray()))
    }

    private fun requests(vararg names: String) = manifest(*names.map { "uses-permission" to it }.toTypedArray())

    private fun assertOneProblem(expected: String, problems: List<String>) {
        assertEquals("expected one problem with \"$expected\", found $problems", 1, problems.size)
        assertTrue("expected \"$expected\" in ${problems.single()}", expected in problems.single())
    }

    @Test
    fun theCheckKnowsTheAllowListsOfWaterRemindersAndTasksAndNoOther() {
        assertEquals(
            mapOf("water" to water.toSet(), "reminders" to reminders.toSet(), "tasks" to tasks.toSet()),
            CheckApkRulesTask.ALLOWED_PERMISSIONS,
        )
    }

    @Test
    fun watersFivePermissionsPass() {
        assertEquals(emptyList<String>(), CheckApkRulesTask.permissionProblems(requests(*water.toTypedArray()), "water"))
    }

    @Test
    fun remindersFivePermissionsPass() {
        assertEquals(emptyList<String>(), CheckApkRulesTask.permissionProblems(requests(*reminders.toTypedArray()), "reminders"))
    }

    @Test
    fun theNetworkPermissionFailsInReminders() = assertOneProblem(
        "android.permission.INTERNET in the manifest (rule 4: not on the allow list of reminders)",
        CheckApkRulesTask.permissionProblems(requests(*(reminders + "android.permission.INTERNET").toTypedArray()), "reminders"),
    )

    @Test
    fun tasksFivePermissionsPass() {
        assertEquals(emptyList<String>(), CheckApkRulesTask.permissionProblems(requests(*tasks.toTypedArray()), "tasks"))
    }

    @Test
    fun theNetworkPermissionFailsInTasks() = assertOneProblem(
        "android.permission.INTERNET in the manifest (rule 4: not on the allow list of tasks)",
        CheckApkRulesTask.permissionProblems(requests(*(tasks + "android.permission.INTERNET").toTypedArray()), "tasks"),
    )

    @Test
    fun aManifestWithNoPermissionPassesForEveryApp() {
        assertEquals(emptyList<String>(), CheckApkRulesTask.permissionProblems(manifest(), "water"))
        assertEquals(emptyList<String>(), CheckApkRulesTask.permissionProblems(manifest(), "catalog"))
    }

    @Test
    fun theNetworkPermissionFailsInWater() = assertOneProblem(
        "android.permission.INTERNET in the manifest (rule 4: not on the allow list of water)",
        CheckApkRulesTask.permissionProblems(requests(*(water + "android.permission.INTERNET").toTypedArray()), "water"),
    )

    @Test
    fun anyOtherPermissionFailsInWater() {
        listOf(
            "android.permission.SCHEDULE_EXACT_ALARM",
            "android.permission.USE_FINGERPRINT",
            "android.permission.SYSTEM_ALERT_WINDOW",
            "app.shkriuss.water.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
        ).forEach { name ->
            assertOneProblem("<uses-permission> $name", CheckApkRulesTask.permissionProblems(requests(name), "water"))
        }
    }

    @Test
    fun everyPermissionFailsInAnAppWithNoAllowList() {
        (water + "android.permission.INTERNET").forEach { name ->
            assertOneProblem("<uses-permission> $name in the manifest (rule 4: no permissions)", CheckApkRulesTask.permissionProblems(requests(name), "catalog"))
        }
    }

    @Test
    fun watersPermissionsAreNotAllowedInAnotherApp() {
        val problems = CheckApkRulesTask.permissionProblems(requests(*water.toTypedArray()), "notes")
        assertEquals(water.map { "<uses-permission> $it in the manifest (rule 4: no permissions)" }, problems)
    }

    @Test
    fun anAllowedNameFailsWhenItIsDeclaredOrRequestedAnyOtherWay() {
        listOf("permission", "uses-permission-sdk-23", "permission-group", "permission-tree").forEach { tag ->
            val name = water.first()
            assertOneProblem(
                "<$tag> $name in the manifest (rule 4: not on the allow list of water)",
                CheckApkRulesTask.permissionProblems(manifest(tag to name), "water"),
            )
        }
    }
}
