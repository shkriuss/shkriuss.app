package app.shkriuss.buildlogic

import org.gradle.api.GradleException
import org.gradle.api.Project
import org.gradle.testfixtures.ProjectBuilder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Shows that `core/testing`, which the logging check does not read, can be
 * declared only by test configurations ([refuseCoreTestingOutsideTests]).
 */
class CoreTestingGuardTest {
    private class Modules(val app: Project, val testing: Project)

    private fun modules(): Modules {
        val root = ProjectBuilder.builder().withName("shkriuss").build()
        val core = ProjectBuilder.builder().withName("core").withParent(root).build()
        val testing = ProjectBuilder.builder().withName("testing").withParent(core).build()
        val app = ProjectBuilder.builder().withName("app").withParent(root).build()
        listOf("implementation", "api", "debugImplementation", "testImplementation", "androidTestImplementation")
            .forEach { app.configurations.create(it) }
        app.refuseCoreTestingOutsideTests()
        return Modules(app, testing)
    }

    private fun declare(configuration: String): Throwable? {
        val modules = modules()
        assertEquals(CORE_TESTING, modules.testing.path)
        return try {
            modules.app.dependencies.add(configuration, modules.app.dependencies.project(mapOf("path" to CORE_TESTING)))
            null
        } catch (failure: Throwable) {
            failure
        }
    }

    private fun assertRefused(configuration: String) {
        val failure = declare(configuration) ?: throw AssertionError("$configuration must refuse $CORE_TESTING")
        val causes = generateSequence(failure) { it.cause }.toList()
        val refusal = causes.filterIsInstance<GradleException>().firstOrNull { it.message.orEmpty().contains(CORE_TESTING) }
        assertTrue("the failure must name the module and the configuration: $causes", refusal?.message.orEmpty().contains("'$configuration'"))
    }

    @Test
    fun mainConfigurationsRefuseCoreTesting() {
        assertRefused("implementation")
        assertRefused("api")
        assertRefused("debugImplementation")
    }

    @Test
    fun testConfigurationsMayUseCoreTesting() {
        assertEquals(null, declare("testImplementation"))
        assertEquals(null, declare("androidTestImplementation"))
    }

    @Test
    fun coreTestingMayNameItselfForItsOwnTests() {
        val testing = modules().testing
        testing.configurations.create("debugAndroidTestCompileClasspath")
        testing.refuseCoreTestingOutsideTests()
        testing.dependencies.add("debugAndroidTestCompileClasspath", testing)
    }

    @Test
    fun testConfigurationsAreTheOnesStartingWithTestOrAndroidTest() {
        listOf("testImplementation", "testDebugImplementation", "testFixturesImplementation", "androidTestImplementation", "androidTestDebugImplementation")
            .forEach { assertTrue(it, isTestConfiguration(it)) }
        listOf("implementation", "api", "compileOnly", "runtimeOnly", "debugImplementation", "releaseImplementation", "kspTest")
            .forEach { assertTrue(it, !isTestConfiguration(it)) }
    }
}
