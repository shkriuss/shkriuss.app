package app.shkriuss.buildlogic

import app.shkriuss.buildlogic.ApkResourceReader.TYPE_INT_BOOLEAN
import app.shkriuss.buildlogic.ApkResourceReader.TYPE_REFERENCE
import app.shkriuss.buildlogic.ApkResourceReader.TYPE_STRING
import app.shkriuss.buildlogic.BinaryResourceWriter.Attribute
import app.shkriuss.buildlogic.BinaryResourceWriter.Element
import app.shkriuss.buildlogic.BinaryResourceWriter.Entry
import app.shkriuss.buildlogic.CheckApkRulesTask.Companion.ALLOW_BACKUP_ID
import app.shkriuss.buildlogic.CheckApkRulesTask.Companion.BACKUP_AGENT_ID
import app.shkriuss.buildlogic.CheckApkRulesTask.Companion.DATA_EXTRACTION_RULES_ID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Shows that rule 6 of the APK rules check ([CheckApkRulesTask.backupProblems])
 * passes an APK whose backup and device transfer are off, as Catalog's are,
 * and fails, naming the attribute, for each way they could be on.
 */
class BackupRulesTest {
    private val rulesId = 0x7f020001

    /** Every domain of Android's data extraction rules. Written out here, so a shorter list in the check fails a test. */
    private val allDomains = listOf(
        "root", "file", "database", "sharedpref", "external",
        "device_root", "device_file", "device_database", "device_sharedpref",
    )

    private val allowBackupFalse = BinaryResourceWriter.android("allowBackup", ALLOW_BACKUP_ID, TYPE_INT_BOOLEAN, 0)
    private val rulesReference = BinaryResourceWriter.android("dataExtractionRules", DATA_EXTRACTION_RULES_ID, TYPE_REFERENCE, rulesId)

    private fun excludeAll(section: String) = Element(section, children = allDomains.map(::exclude))

    private fun exclude(domain: String) = Element("exclude", listOf(BinaryResourceWriter.plain("domain", domain), BinaryResourceWriter.plain("path", ".")))

    /** The rules of Catalog: both sections exclude all nine domains. */
    private val catalogRules = Element("data-extraction-rules", children = listOf(excludeAll("cloud-backup"), excludeAll("device-transfer")))

    /** An APK as a map of paths to bytes. [secondRules] adds a `-v35` configuration of the rules file. */
    private fun apk(
        applicationAttributes: List<Attribute> = listOf(allowBackupFalse, rulesReference),
        rules: Element? = catalogRules,
        secondRules: Element? = null,
    ): (String) -> ByteArray? {
        val files = mutableMapOf(
            "AndroidManifest.xml" to BinaryResourceWriter.xml(Element("manifest", children = listOf(Element("application", applicationAttributes)))),
        )
        val entries = mutableListOf(listOf(Entry(0, "other", TYPE_STRING, string = "res/a.xml"), Entry(1, "data_extraction_rules", TYPE_STRING, string = "res/Ab.xml")))
        rules?.let { files["res/Ab.xml"] = BinaryResourceWriter.xml(it) }
        secondRules?.let {
            files["res/Cd.xml"] = BinaryResourceWriter.xml(it)
            entries += listOf(Entry(1, "data_extraction_rules", TYPE_STRING, string = "res/Cd.xml"))
        }
        files["resources.arsc"] = BinaryResourceWriter.table(entries)
        return files::get
    }

    private fun problems(apk: (String) -> ByteArray?) = CheckApkRulesTask.backupProblems(apk)

    private fun assertOneProblem(expected: String, apk: (String) -> ByteArray?) {
        val problems = problems(apk)
        assertEquals("expected one problem with \"$expected\", found $problems", 1, problems.size)
        assertTrue("expected \"$expected\" in ${problems.single()}", expected in problems.single())
    }

    @Test
    fun theCheckKnowsEveryDomain() = assertEquals(allDomains, CheckApkRulesTask.RULES_DOMAINS)

    @Test
    fun catalogsSettingsPass() {
        assertEquals(emptyList<String>(), problems(apk()))
        assertEquals(emptyList<String>(), problems(apk(secondRules = catalogRules)))
    }

    @Test
    fun allowBackupTrueFails() = assertOneProblem(
        "android:allowBackup is true",
        apk(listOf(BinaryResourceWriter.android("allowBackup", ALLOW_BACKUP_ID, TYPE_INT_BOOLEAN, -1), rulesReference)),
    )

    @Test
    fun allowBackupMissingFails() = assertOneProblem("android:allowBackup is not set", apk(listOf(rulesReference)))

    @Test
    fun allowBackupFromAResourceFails() = assertOneProblem(
        "android:allowBackup is not written as true or false",
        apk(listOf(BinaryResourceWriter.android("allowBackup", ALLOW_BACKUP_ID, TYPE_REFERENCE, 0x7f030001), rulesReference)),
    )

    @Test
    fun aBackupAgentFails() = assertOneProblem(
        "android:backupAgent is set (.Agent)",
        apk(listOf(allowBackupFalse, rulesReference, Attribute(ApkResourceReader.ANDROID_NAMESPACE, "backupAgent", BACKUP_AGENT_ID, TYPE_STRING, -1, ".Agent"))),
    )

    @Test
    fun noDataExtractionRulesFails() = assertOneProblem("android:dataExtractionRules is not set", apk(listOf(allowBackupFalse)))

    @Test
    fun rulesThatAreNoReferenceFail() = assertOneProblem(
        "android:dataExtractionRules does not name an XML resource",
        apk(listOf(allowBackupFalse, BinaryResourceWriter.android("dataExtractionRules", DATA_EXTRACTION_RULES_ID, TYPE_INT_BOOLEAN, 0))),
    )

    @Test
    fun aRulesFileTheApkDoesNotHoldFails() = assertOneProblem("names res/Ab.xml, which the APK does not hold", apk(rules = null))

    @Test
    fun aResourceTheTableDoesNotHoldFails() = assertOneProblem(
        "names resource 0x7f020007",
        apk(listOf(allowBackupFalse, BinaryResourceWriter.android("dataExtractionRules", DATA_EXTRACTION_RULES_ID, TYPE_REFERENCE, 0x7f020007))),
    )

    @Test
    fun anIncludeFails() {
        val rules = Element(
            "data-extraction-rules",
            children = listOf(Element("cloud-backup", children = allDomains.map(::exclude) + Element("include", listOf(BinaryResourceWriter.plain("domain", "file")))), excludeAll("device-transfer")),
        )
        assertOneProblem("<cloud-backup> holds <include>", apk(rules = rules))
    }

    @Test
    fun eachDomainMustBeExcludedInEachSection() {
        for (section in listOf("cloud-backup", "device-transfer")) {
            for (domain in allDomains) {
                val sections = listOf("cloud-backup", "device-transfer").map { name ->
                    if (name == section) Element(name, children = allDomains.filter { it != domain }.map(::exclude)) else excludeAll(name)
                }
                assertOneProblem("<$section> does not exclude the domain $domain", apk(rules = Element("data-extraction-rules", children = sections)))
            }
        }
    }

    @Test
    fun anExcludeOfOnlyAFolderDoesNotCount() {
        val partly = Element("exclude", listOf(BinaryResourceWriter.plain("domain", "database"), BinaryResourceWriter.plain("path", "notes.db")))
        val section = Element("device-transfer", children = allDomains.filter { it != "database" }.map(::exclude) + partly)
        assertOneProblem(
            "<device-transfer> does not exclude the domain database",
            apk(rules = Element("data-extraction-rules", children = listOf(excludeAll("cloud-backup"), section))),
        )
    }

    @Test
    fun crossPlatformTransferFails() {
        val optIn = Element("cross-platform-transfer", listOf(BinaryResourceWriter.plain("platform", "ios")), listOf(Element("include", listOf(BinaryResourceWriter.plain("domain", "file")))))
        assertOneProblem(
            "<cross-platform-transfer> is not allowed",
            apk(rules = Element("data-extraction-rules", children = catalogRules.children + optIn)),
        )
    }

    @Test
    fun aMissingOrDoubledSectionFails() {
        assertOneProblem("0 <device-transfer> sections", apk(rules = Element("data-extraction-rules", children = listOf(excludeAll("cloud-backup")))))
        assertOneProblem("2 <cloud-backup> sections", apk(rules = Element("data-extraction-rules", children = catalogRules.children + excludeAll("cloud-backup"))))
    }

    @Test
    fun aWrongRootFails() = assertOneProblem("the root is <full-backup-content>", apk(rules = Element("full-backup-content")))

    @Test
    fun aWrongSecondConfigurationFailsAndIsNamed() {
        val wrong = Element("data-extraction-rules", children = listOf(excludeAll("cloud-backup"), Element("device-transfer")))
        val problems = problems(apk(secondRules = wrong))
        assertEquals(allDomains.size, problems.size)
        assertTrue(problems.toString(), problems.all { it.startsWith("the rules file res/Cd.xml (@xml/data_extraction_rules): <device-transfer>") })
    }
}
