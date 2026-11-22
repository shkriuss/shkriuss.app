package app.shkriuss.buildlogic

import java.io.ByteArrayInputStream
import javax.xml.XMLConstants
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Document

/**
 * Shows that the rule of ADR 0033, point 5, in the APK rules check
 * ([CheckApkRulesTask.securityScreenProblems]) fails an app whose merged
 * manifest declares a screen of `core/security` unless it requests both
 * `USE_BIOMETRIC` and `HIDE_OVERLAY_WINDOWS`, names each permission that is
 * missing, and passes an app with no such screen. The owner asked for the
 * rule and this test in step 2.5.
 *
 * The names of the screens and of the permissions are written out here, not
 * taken from the check. So a check with a shorter list fails a test.
 */
class SecurityScreensRuleTest {
    /** The eight screens of `core/security`, as its manifest declares them. */
    private val screens = listOf(
        "app.shkriuss.core.security.SecurityActivity",
        "app.shkriuss.core.security.CreateRecoveryKeyActivity",
        "app.shkriuss.core.security.EnterRecoveryKeyActivity",
        "app.shkriuss.core.security.ShowRecoveryKeyActivity",
        "app.shkriuss.core.security.AppLockActivity",
        "app.shkriuss.core.security.TurnOnAppLockActivity",
        "app.shkriuss.core.security.HandoverActivity",
        "app.shkriuss.core.security.GetKeysActivity",
    )

    private val prompt = "android.permission.USE_BIOMETRIC"
    private val hiding = "android.permission.HIDE_OVERLAY_WINDOWS"

    /** A merged manifest with one element per entry of [permissions], a tag and its name, and the screens [activities]. */
    private fun manifest(permissions: List<Pair<String, String>>, activities: List<String>): Document {
        val requested = permissions.joinToString("\n") { (tag, name) -> """    <$tag android:name="$name" />""" }
        val declared = activities.joinToString("\n") { """        <activity android:name="$it" android:exported="false" />""" }
        val xml = """
            <manifest xmlns:android="http://schemas.android.com/apk/res/android" package="app.shkriuss.test">
            $requested
                <application>
            $declared
                </application>
            </manifest>
        """.trimIndent()
        val factory = DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = true
            setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true)
            setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        }
        return factory.newDocumentBuilder().parse(ByteArrayInputStream(xml.toByteArray()))
    }

    private fun requests(vararg names: String) = names.map { "uses-permission" to it }

    private fun problems(permissions: List<Pair<String, String>>, activities: List<String>): List<String> =
        CheckApkRulesTask.securityScreenProblems(manifest(permissions, activities))

    private fun assertOneProblem(expected: String, problems: List<String>) {
        assertEquals("expected one problem with \"$expected\", found $problems", 1, problems.size)
        assertTrue("expected \"$expected\" in ${problems.single()}", expected in problems.single())
        assertTrue("the problem names its decision record: ${problems.single()}", "ADR 0033" in problems.single())
    }

    @Test
    fun anAppWithTheScreensAndBothPermissionsPasses() {
        assertEquals(emptyList<String>(), problems(requests(prompt, hiding), screens))
        // As Water has them, beside the three of its reminders and its own screen.
        val water = requests("android.permission.POST_NOTIFICATIONS", prompt, "android.permission.USE_EXACT_ALARM", hiding)
        assertEquals(emptyList<String>(), problems(water, listOf("app.shkriuss.water.WaterActivity") + screens))
    }

    @Test
    fun anAppWithNoScreenOfCoreSecurityNeedsNeitherPermission() {
        // As Catalog: it removes the eight screens and both permissions.
        assertEquals(emptyList<String>(), problems(emptyList(), listOf("app.shkriuss.catalog.CatalogActivity")))
        assertEquals(emptyList<String>(), problems(emptyList(), emptyList()))
    }

    @Test
    fun theScreensWithoutThePermissionToHideOtherAppsWindowsFail() =
        assertOneProblem("no <uses-permission> $hiding", problems(requests(prompt), screens))

    @Test
    fun theScreensWithoutThePermissionForTheSystemPromptFail() =
        assertOneProblem("no <uses-permission> $prompt", problems(requests(hiding), screens))

    @Test
    fun theScreensWithNeitherPermissionFailOnceForEach() {
        val found = problems(emptyList(), screens)
        assertEquals(found.toString(), 2, found.size)
        assertTrue(found.toString(), found.any { "no <uses-permission> $prompt" in it })
        assertTrue(found.toString(), found.any { "no <uses-permission> $hiding" in it })
        found.forEach { assertTrue(it, "ADR 0033" in it) }
    }

    @Test
    fun eachOfTheEightScreensAloneNeedsBothPermissions() {
        screens.forEach { screen ->
            val found = problems(requests(prompt), listOf("app.shkriuss.water.WaterActivity", screen))
            assertOneProblem("<activity> $screen of core/security", found)
            assertTrue(found.single(), "no <uses-permission> $hiding" in found.single())
        }
    }

    @Test
    fun aNewScreenOfTheModuleCountsToo() =
        assertOneProblem(
            "<activity> app.shkriuss.core.security.SomeLaterActivity of core/security",
            problems(requests(prompt), listOf("app.shkriuss.core.security.SomeLaterActivity")),
        )

    @Test
    fun theProblemNamesTheFirstScreenAndCountsTheRest() =
        assertOneProblem("<activity> ${screens.first()} and 7 more of core/security", problems(requests(prompt), screens))

    @Test
    fun aPermissionDeclaredOrAskedAnyOtherWayDoesNotCount() {
        listOf("permission", "uses-permission-sdk-23").forEach { tag ->
            assertOneProblem("no <uses-permission> $hiding", problems(requests(prompt) + (tag to hiding), screens))
        }
    }

    @Test
    fun aScreenOfAnotherPackageWithALikeNameDoesNotCount() {
        val others = listOf("app.shkriuss.core.securityx.SecurityActivity", "com.example.app.shkriuss.core.security.SecurityActivity")
        assertEquals(emptyList<String>(), problems(emptyList(), others))
    }
}
