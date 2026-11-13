package app.shkriuss.buildlogic

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Writes binary XML and binary resource tables for the tests, in the
 * formats of AOSP's `ResourceTypes.h`, so the tests need no aapt2 and no
 * binary files in the repository. It writes each layout that
 * [ApkResourceReader] reads. That the reader also reads real aapt2 output is
 * shown by the check on Catalog's own APKs (docs/development/build.md).
 */
internal object BinaryResourceWriter {
    /** An element to write. */
    class Element(val name: String, val attributes: List<Attribute> = emptyList(), val children: List<Element> = emptyList())

    /**
     * An attribute to write: its namespace, its name, the resource ID of its
     * name if it has one, its typed value, and its raw text if any.
     */
    class Attribute(val namespace: String?, val name: String, val resourceId: Int?, val type: Int, val data: Int, val raw: String?)

    /** An attribute in Android's namespace with a resource ID and a typed value, as aapt2 writes it. */
    fun android(name: String, resourceId: Int, type: Int, data: Int) =
        Attribute(ApkResourceReader.ANDROID_NAMESPACE, name, resourceId, type, data, raw = null)

    /** A plain attribute with text, such as `domain="root"`. Its typed value points to the same string. */
    fun plain(name: String, text: String) = Attribute(null, name, null, ApkResourceReader.TYPE_STRING, -1, text)

    /** How a type chunk stores the offsets of its entries. */
    enum class Offsets { PLAIN_32, OFFSET_16, SPARSE }

    /** One entry of a resource table: its index in its type, its key name, and its value. */
    class Entry(val index: Int, val name: String, val type: Int, val data: Int = 0, val string: String? = null)

    private const val NO_INDEX = -1

    /** Writes [root] as a binary XML file, with UTF-8 or UTF-16 strings. */
    fun xml(root: Element, utf8: Boolean = true): ByteArray {
        val all = mutableListOf<Element>()
        fun collect(element: Element) {
            all += element
            element.children.forEach(::collect)
        }
        collect(root)
        val attributes = all.flatMap { it.attributes }
        // Names with a resource ID come first, in the order of the resource map.
        val mapped = attributes.filter { it.resourceId != null }.distinctBy { it.name }
        val strings = Strings()
        mapped.forEach { strings.index(it.name) }
        val namespaces = attributes.mapNotNull { it.namespace }.distinct()
        namespaces.forEach { strings.index(it) }
        all.forEach { element ->
            strings.index(element.name)
            element.attributes.forEach { attribute ->
                strings.index(attribute.name)
                attribute.raw?.let { strings.index(it) }
            }
        }

        val body = ByteArrayOutputStream()
        body.write(chunk(0x0180, 8, ints(mapped.map { it.resourceId!! })))
        namespaces.forEach { body.write(namespaceChunk(0x0100, strings.index("android"), strings.index(it))) }
        fun write(element: Element) {
            val ext = buffer(20 + 20 * element.attributes.size)
            ext.putInt(NO_INDEX).putInt(strings.index(element.name))
            ext.putShort(20).putShort(20).putShort(element.attributes.size.toShort())
            ext.putShort(0).putShort(0).putShort(0)
            element.attributes.forEach { attribute ->
                ext.putInt(attribute.namespace?.let(strings::index) ?: NO_INDEX)
                ext.putInt(strings.index(attribute.name))
                ext.putInt(attribute.raw?.let(strings::index) ?: NO_INDEX)
                ext.putShort(8).put(0).put(attribute.type.toByte())
                ext.putInt(if (attribute.type == ApkResourceReader.TYPE_STRING && attribute.raw != null) strings.index(attribute.raw) else attribute.data)
            }
            body.write(chunk(0x0102, 16, node() + ext.array()))
            element.children.forEach(::write)
            body.write(chunk(0x0103, 16, node() + buffer(8).putInt(NO_INDEX).putInt(strings.index(element.name)).array()))
        }
        write(root)
        namespaces.reversed().forEach { body.write(namespaceChunk(0x0101, strings.index("android"), strings.index(it))) }
        return chunk(0x0003, 8, strings.pool(utf8) + body.toByteArray())
    }

    /**
     * Writes a resource table with one package and one type, [typeId], named
     * "xml". Each list in [configurations] becomes one type chunk, for one
     * configuration.
     */
    fun table(
        configurations: List<List<Entry>>,
        typeId: Int = 2,
        packageId: Int = 0x7f,
        offsets: Offsets = Offsets.PLAIN_32,
        compact: Boolean = false,
        utf8: Boolean = true,
    ): ByteArray {
        val global = Strings()
        val keys = Strings()
        configurations.flatten().forEach { entry ->
            keys.index(entry.name)
            entry.string?.let { global.index(it) }
        }
        val types = Strings()
        (1 until typeId).forEach { types.index("type$it") }
        types.index("xml")
        val entryCount = (configurations.flatten().maxOfOrNull { it.index } ?: 0) + 1

        val typeStrings = types.pool(utf8)
        val keyStrings = keys.pool(utf8)
        val packageBody = ByteArrayOutputStream()
        packageBody.write(typeStrings)
        packageBody.write(keyStrings)
        val spec = buffer(8 + 4 * entryCount).put(typeId.toByte()).put(0).putShort(0).putInt(entryCount)
        packageBody.write(chunk(0x0202, 16, spec.array()))
        configurations.forEachIndexed { number, entries ->
            packageBody.write(typeChunk(typeId, entries, entryCount, offsets, compact, keys, global, sdkVersion = if (number == 0) 0 else 35))
        }

        val packageHeader = buffer(280)
        packageHeader.putInt(packageId)
        repeat(128) { packageHeader.putShort(0) }
        packageHeader.putInt(288)
        packageHeader.putInt(0)
        packageHeader.putInt(288 + typeStrings.size)
        packageHeader.putInt(0)
        packageHeader.putInt(0)
        val packageChunk = chunk(0x0200, 288, packageHeader.array() + packageBody.toByteArray())
        return chunk(0x0002, 12, buffer(4).putInt(1).array() + global.pool(utf8) + packageChunk)
    }

    private fun typeChunk(
        typeId: Int,
        entries: List<Entry>,
        entryCount: Int,
        offsets: Offsets,
        compact: Boolean,
        keys: Strings,
        global: Strings,
        sdkVersion: Int,
    ): ByteArray {
        val data = ByteArrayOutputStream()
        val offsetOf = mutableMapOf<Int, Int>()
        entries.forEach { entry ->
            offsetOf[entry.index] = data.size()
            val value = if (entry.type == ApkResourceReader.TYPE_STRING) global.index(entry.string!!) else entry.data
            if (compact) {
                data.write(buffer(8).putShort(keys.index(entry.name).toShort()).putShort(((entry.type shl 8) or 0x08).toShort()).putInt(value).array())
            } else {
                data.write(buffer(16).putShort(8).putShort(0).putInt(keys.index(entry.name)).putShort(8).put(0).put(entry.type.toByte()).putInt(value).array())
            }
        }
        val offsetTable = when (offsets) {
            Offsets.PLAIN_32 -> ints(List(entryCount) { offsetOf[it] ?: NO_INDEX })
            Offsets.OFFSET_16 -> padded(shorts(List(entryCount) { offsetOf[it]?.div(4) ?: 0xffff }))
            Offsets.SPARSE -> shorts(offsetOf.entries.sortedBy { it.key }.flatMap { listOf(it.key, it.value / 4) })
        }
        val count = if (offsets == Offsets.SPARSE) offsetOf.size else entryCount
        val flags = when (offsets) {
            Offsets.PLAIN_32 -> 0
            Offsets.OFFSET_16 -> 0x02
            Offsets.SPARSE -> 0x01
        }
        val config = buffer(64).putInt(64)
        config.putInt(24, sdkVersion)
        val headerSize = 20 + 64
        val header = buffer(12).put(typeId.toByte()).put(flags.toByte()).putShort(0).putInt(count).putInt(headerSize + offsetTable.size)
        return chunk(0x0201, headerSize, header.array() + config.array() + offsetTable + data.toByteArray())
    }

    /** A string pool that numbers each string the first time it is asked for. */
    private class Strings {
        private val list = mutableListOf<String>()

        fun index(string: String): Int = list.indexOf(string).takeIf { it >= 0 } ?: list.size.also { list += string }

        fun pool(utf8: Boolean): ByteArray {
            val data = ByteArrayOutputStream()
            val offsets = list.map { string ->
                val at = data.size()
                if (utf8) {
                    val bytes = string.toByteArray(Charsets.UTF_8)
                    data.write(length8(string.length))
                    data.write(length8(bytes.size))
                    data.write(bytes)
                    data.write(0)
                } else {
                    data.write(length16(string.length))
                    string.forEach { data.write(buffer(2).putShort(it.code.toShort()).array()) }
                    data.write(byteArrayOf(0, 0))
                }
                at
            }
            val header = buffer(20).putInt(list.size).putInt(0).putInt(if (utf8) 0x100 else 0).putInt(28 + 4 * list.size).putInt(0)
            return chunk(0x0001, 28, header.array() + ints(offsets) + padded(data.toByteArray()))
        }

        private fun length8(length: Int): ByteArray =
            if (length < 0x80) byteArrayOf(length.toByte()) else byteArrayOf(((length shr 8) or 0x80).toByte(), length.toByte())

        private fun length16(length: Int): ByteArray =
            if (length < 0x8000) buffer(2).putShort(length.toShort()).array()
            else buffer(4).putShort(((length shr 16) or 0x8000).toShort()).putShort(length.toShort()).array()
    }

    private fun namespaceChunk(type: Int, prefix: Int, uri: Int) = chunk(type, 16, node() + buffer(8).putInt(prefix).putInt(uri).array())

    /** The line number and comment of an XML node. */
    private fun node() = buffer(8).putInt(1).putInt(NO_INDEX).array()

    private fun chunk(type: Int, headerSize: Int, rest: ByteArray): ByteArray =
        buffer(8).putShort(type.toShort()).putShort(headerSize.toShort()).putInt(8 + rest.size).array() + rest

    private fun buffer(size: Int): ByteBuffer = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN)

    private fun ints(values: List<Int>): ByteArray = buffer(4 * values.size).apply { values.forEach { putInt(it) } }.array()

    private fun shorts(values: List<Int>): ByteArray = buffer(2 * values.size).apply { values.forEach { putShort(it.toShort()) } }.array()

    private fun padded(bytes: ByteArray): ByteArray = bytes + ByteArray((4 - bytes.size % 4) % 4)
}
