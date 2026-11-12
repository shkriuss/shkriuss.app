package app.shkriuss.buildlogic

import java.io.ByteArrayInputStream
import java.io.DataInputStream
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * Fails the build when code could remove a record for good or write one
 * past `RecordWriter` (ADR 0027, docs/architecture/data.md). It fails if:
 *
 * - a function is annotated `@Delete` or `@Upsert`,
 * - a function is annotated `@Insert` or `@Update`, unless it is in
 *   `RecordDao` itself, whose `rawInsert` and `rawUpdate` `RecordWriter`
 *   uses,
 * - a function is annotated `@Insert` or `@Update` with
 *   `OnConflictStrategy.REPLACE`, even in `RecordDao`,
 * - a function is annotated `@Query` with SQL that contains `INSERT`,
 *   `DELETE`, `UPDATE`, `REPLACE INTO` or `OR REPLACE`,
 * - a class other than `RecordWriter` calls `rawInsert` or `rawUpdate`.
 *
 * The one exception is a function marked `@PurgesDeletedRecords` whose
 * query is `DELETE FROM <table> WHERE deletedAt IS NOT NULL`, optionally
 * followed by `AND` and more conditions, with no `OR`. A class may have
 * only one.
 *
 * Room's annotations and every method a class calls stay in the class
 * files, so the check reads the compiled classes of the module, main and
 * tests. It sees each query as the compiler wrote it, with every constant
 * joined in. It cannot see SQL that code runs outside a DAO.
 */
abstract class CheckDaoRulesTask : DefaultTask() {
    /** The compiled classes of the module: the output folders of its Kotlin compile tasks. */
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val classes: ConfigurableFileCollection

    /** Written when the check passes, so Gradle can skip the task next time. */
    @get:OutputFile
    abstract val report: RegularFileProperty

    @TaskAction
    fun check() {
        val classFiles = classes.asFileTree.matching { include("**/*.class") }.files
        val problems = sortedSetOf<String>()
        classFiles.forEach { file -> problems += daoRuleProblems(ClassFileReader.read(file.readBytes())) }
        if (problems.isNotEmpty()) {
            throw GradleException(failureMessage(problems))
        }
        report.get().asFile.writeText(
            "Checked ${classFiles.size} classes. No DAO writes or deletes records, " +
                "and only RecordWriter calls rawInsert and rawUpdate.\n",
        )
    }

    private fun failureMessage(problems: Set<String>): String = buildString {
        appendLine("Code can remove records for good, or write them past RecordWriter:")
        problems.forEach { appendLine("- $it") }
        appendLine("Records are only marked as deleted, and every write goes through RecordWriter,")
        appendLine("which stamps the record fields and the change number (ADR 0027).")
        appendLine("Use RecordWriter instead. If a table that is not a record needs a write, or")
        appendLine("RecordWriter cannot do what is needed, stop and ask the owner.")
        append("Do not change this check. See docs/development/build.md, \"DAO rules check\".")
    }

    internal companion object {
        const val DELETE = "Landroidx/room3/Delete;"
        const val UPSERT = "Landroidx/room3/Upsert;"
        const val INSERT = "Landroidx/room3/Insert;"
        const val UPDATE = "Landroidx/room3/Update;"
        const val QUERY = "Landroidx/room3/Query;"
        const val PURGE_MARKER = "Lapp/shkriuss/core/data/PurgesDeletedRecords;"

        /** The one interface whose functions may be `@Insert` and `@Update`. */
        const val RECORD_DAO = "app.shkriuss.core.data.RecordDao"

        /** The one class that may call [RAW_WRITES], with its nested classes. */
        const val RECORD_WRITER = "app.shkriuss.core.data.RecordWriter"

        /** The functions of [RECORD_DAO] that store a record without stamping it. */
        val RAW_WRITES = setOf("rawInsert", "rawUpdate")

        /** `OnConflictStrategy.REPLACE`, which Room stores as this number. */
        const val REPLACE_STRATEGY = 1

        private val WRITE_WORDS =
            Regex("""\b(INSERT|DELETE|UPDATE)\b|\bREPLACE\s+INTO\b|\bOR\s+REPLACE\b""", RegexOption.IGNORE_CASE)

        /** The only purge allowed. Identifiers may be quoted. */
        private val PURGE = Regex(
            """^DELETE\s+FROM\s+[`"\[]?\w+[`"\]]?\s+WHERE\s+[`"\[]?deletedAt[`"\]]?\s+IS\s+NOT\s+NULL(\s+AND\s+(.*))?$""",
            RegexOption.IGNORE_CASE,
        )

        /** What is wrong with one class, empty if nothing. */
        fun daoRuleProblems(type: ClassFileReader.ClassAnnotations): List<String> =
            type.methods.flatMap { annotationProblems(type.name, it) } +
                purgeCountProblems(type) +
                rawWriteCallProblems(type)

        private fun annotationProblems(className: String, method: ClassFileReader.MethodAnnotations): List<String> {
            val name = "$className.${method.name}"
            val annotations = method.annotations.associateBy { it.type }
            val problems = mutableListOf<String>()
            if (DELETE in annotations) problems += "$name is @Delete"
            if (UPSERT in annotations) problems += "$name is @Upsert"
            for ((write, label) in listOf(INSERT to "@Insert", UPDATE to "@Update")) {
                val annotation = annotations[write] ?: continue
                if (className != RECORD_DAO) problems += "$name is $label"
                if (annotation.values["onConflict"] == REPLACE_STRATEGY) problems += "$name uses OnConflictStrategy.REPLACE"
            }
            val sql = (annotations[QUERY]?.values?.get("value") as? String)?.let(::plainSql)
            val marked = PURGE_MARKER in annotations
            when {
                marked && sql != null && isPurge(sql) -> Unit
                marked -> problems += "$name is marked @PurgesDeletedRecords, but is not " +
                    "a @Query DELETE ... WHERE deletedAt IS NOT NULL with no OR"
                sql != null && WRITE_WORDS.containsMatchIn(sql) -> problems += "$name runs a writing query: $sql"
            }
            return problems
        }

        private fun purgeCountProblems(type: ClassFileReader.ClassAnnotations): List<String> {
            val purges = type.methods.count { method ->
                val annotations = method.annotations.associateBy { it.type }
                val sql = (annotations[QUERY]?.values?.get("value") as? String)?.let(::plainSql)
                PURGE_MARKER in annotations && sql != null && isPurge(sql)
            }
            return if (purges > 1) listOf("${type.name} has $purges functions marked @PurgesDeletedRecords, not one") else emptyList()
        }

        /**
         * A call to `rawInsert` or `rawUpdate` from any class but
         * [RECORD_WRITER] and its nested classes, such as its coroutine
         * steps. A class that calls its own function of that name is left
         * alone: that is the bridge the Kotlin compiler adds to a DAO
         * implementation that Room generates.
         */
        private fun rawWriteCallProblems(type: ClassFileReader.ClassAnnotations): List<String> {
            if (type.name == RECORD_WRITER || type.name.startsWith("$RECORD_WRITER$")) return emptyList()
            return type.calls
                .filter { call -> call.method in RAW_WRITES && call.owner != type.name }
                .map { call -> "${type.name} calls ${call.owner}.${call.method}, which only RecordWriter may call" }
                .distinct()
        }

        /** True for a purge of deleted rows only. */
        fun isPurge(sql: String): Boolean {
            val match = PURGE.matchEntire(sql) ?: return false
            val more = match.groupValues[2]
            return !Regex("""\bOR\b""", RegexOption.IGNORE_CASE).containsMatchIn(more) &&
                !WRITE_WORDS.containsMatchIn(more)
        }

        /** The SQL without comments and string literals, with single spaces. */
        fun plainSql(sql: String): String =
            sql.replace(Regex("""--[^\n]*"""), " ")
                .replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), " ")
                .replace(Regex("""'(?:[^']|'')*'"""), "''")
                .replace(Regex("""\s+"""), " ")
                .trim()
                .removeSuffix(";")
                .trim()
    }
}

/**
 * Reads what the DAO rules check needs from a class file: the annotations
 * of its methods, and the methods it calls. It follows the class file
 * format of the Java Virtual Machine Specification, chapter 4, and needs no
 * library.
 */
internal object ClassFileReader {
    /** A class: its name, with dots, its methods, and the methods it calls. */
    class ClassAnnotations(val name: String, val methods: List<MethodAnnotations>, val calls: List<MethodCall>)

    /** A method: its name and its annotations. */
    class MethodAnnotations(val name: String, val annotations: List<Annotation>)

    /** An annotation: its type descriptor, such as `Landroidx/room3/Query;`, and its string and int values. */
    class Annotation(val type: String, val values: Map<String, Any>)

    /** A method that a class refers to: the class that declares it, with dots, and its name. */
    data class MethodCall(val owner: String, val method: String)

    /** A method reference in the constant pool: the index of its class and of its name and type. */
    private class MethodRef(val classIndex: Int, val nameAndTypeIndex: Int)

    /** A name and type in the constant pool: the index of the name. */
    private class NameAndType(val nameIndex: Int)

    private class Pool(val entries: Array<Any?>) {
        fun utf8(index: Int): String = entries[index] as String
        fun className(index: Int): String = utf8(entries[index] as Int)

        fun calls(): List<MethodCall> = entries.filterIsInstance<MethodRef>().map { ref ->
            val name = utf8((entries[ref.nameAndTypeIndex] as NameAndType).nameIndex)
            MethodCall(owner = className(ref.classIndex).replace('/', '.'), method = name)
        }
    }

    /** Reads [bytes], the contents of one `.class` file. */
    fun read(bytes: ByteArray): ClassAnnotations {
        val input = DataInputStream(ByteArrayInputStream(bytes))
        check(input.readInt() == CLASS_FILE_MAGIC) { "Not a class file" }
        input.readUnsignedShort()
        input.readUnsignedShort()
        val pool = readPool(input)
        input.readUnsignedShort()
        val name = pool.className(input.readUnsignedShort()).replace('/', '.')
        input.readUnsignedShort()
        repeat(input.readUnsignedShort()) { input.readUnsignedShort() }
        repeat(input.readUnsignedShort()) { readMember(input, pool) }
        val methods = List(input.readUnsignedShort()) { readMember(input, pool) }
        return ClassAnnotations(name, methods, pool.calls())
    }

    private fun readPool(input: DataInputStream): Pool {
        val count = input.readUnsignedShort()
        val entries = arrayOfNulls<Any>(count)
        var index = 1
        while (index < count) {
            when (val tag = input.readUnsignedByte()) {
                1 -> entries[index] = input.readUTF()
                3 -> entries[index] = input.readInt()
                4 -> input.readInt()
                5, 6 -> {
                    input.readLong()
                    index++
                }
                7 -> entries[index] = input.readUnsignedShort()
                8, 16, 19, 20 -> input.readUnsignedShort()
                10, 11 -> entries[index] = MethodRef(input.readUnsignedShort(), input.readUnsignedShort())
                12 -> {
                    entries[index] = NameAndType(input.readUnsignedShort())
                    input.readUnsignedShort()
                }
                9, 17, 18 -> input.readInt()
                15 -> {
                    input.readUnsignedByte()
                    input.readUnsignedShort()
                }
                else -> error("Unknown constant pool tag $tag")
            }
            index++
        }
        return Pool(entries)
    }

    private fun readMember(input: DataInputStream, pool: Pool): MethodAnnotations {
        input.readUnsignedShort()
        val name = pool.utf8(input.readUnsignedShort())
        input.readUnsignedShort()
        val annotations = mutableListOf<Annotation>()
        repeat(input.readUnsignedShort()) {
            val attribute = pool.utf8(input.readUnsignedShort())
            val length = input.readInt()
            if (attribute in ANNOTATION_ATTRIBUTES) {
                repeat(input.readUnsignedShort()) { annotations += readAnnotation(input, pool) }
            } else {
                input.skipNBytes(length.toLong())
            }
        }
        return MethodAnnotations(name, annotations)
    }

    private fun readAnnotation(input: DataInputStream, pool: Pool): Annotation {
        val type = pool.utf8(input.readUnsignedShort())
        val values = mutableMapOf<String, Any>()
        repeat(input.readUnsignedShort()) {
            val name = pool.utf8(input.readUnsignedShort())
            readValue(input, pool)?.let { values[name] = it }
        }
        return Annotation(type, values)
    }

    /** Returns the value for strings and ints. Other kinds are read past and give null. */
    private fun readValue(input: DataInputStream, pool: Pool): Any? =
        when (val tag = input.readUnsignedByte().toChar()) {
            's' -> pool.utf8(input.readUnsignedShort())
            'I', 'B', 'C', 'S', 'Z' -> pool.entries[input.readUnsignedShort()]
            'J', 'D', 'F', 'c' -> {
                input.readUnsignedShort()
                null
            }
            'e' -> {
                input.readUnsignedShort()
                input.readUnsignedShort()
                null
            }
            '@' -> {
                readAnnotation(input, pool)
                null
            }
            '[' -> {
                repeat(input.readUnsignedShort()) { readValue(input, pool) }
                null
            }
            else -> error("Unknown annotation value tag $tag")
        }

    private const val CLASS_FILE_MAGIC = 0xCAFEBABE.toInt()
    private val ANNOTATION_ATTRIBUTES = setOf("RuntimeInvisibleAnnotations", "RuntimeVisibleAnnotations")
}
