package app.shkriuss.buildlogic

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Reads what the backup rule of [CheckApkRulesTask] needs from an APK, as it
 * ships: the compiled manifest, a compiled XML file, and the values of one
 * resource in `resources.arsc`. An APK holds these as binary XML and a
 * binary resource table, not as text.
 *
 * It follows the formats in AOSP's `ResourceTypes.h` (frameworks/base,
 * libs/androidfw) and needs no library, as [ClassFileReader] does for class
 * files. Anything it does not understand throws [IllegalArgumentException]
 * or an out-of-bounds exception. The check reports that as a failure, so it
 * never passes on a file it could not read.
 */
internal object ApkResourceReader {
    /** One element of a binary XML file, with its attributes and child elements in order. */
    class XmlElement(val name: String, val attributes: List<XmlAttribute>, val children: List<XmlElement>) {
        /** The attribute in Android's namespace with this resource ID or name, or null. */
        fun androidAttribute(resourceId: Int, name: String): XmlAttribute? =
            attributes.firstOrNull { it.resourceId == resourceId || (it.namespace == ANDROID_NAMESPACE && it.name == name) }

        /** The text of the attribute with this name and no namespace, or null. */
        fun plainAttribute(name: String): String? =
            attributes.firstOrNull { it.namespace == null && it.name == name }?.text
    }

    /**
     * One attribute: its namespace and name, the resource ID of its name if
     * the file maps one, its value as typed data, and its text if it is a
     * string.
     */
    class XmlAttribute(
        val namespace: String?,
        val name: String,
        val resourceId: Int?,
        val type: Int,
        val data: Int,
        val text: String?,
    )

    /** One value of a resource in one configuration: its key name, typed data, and the string if it is one. */
    class ResourceValue(val name: String, val type: Int, val data: Int, val string: String?)

    /** The namespace of Android's own attributes. */
    const val ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android"

    /** Typed value kinds (`Res_value::dataType`). */
    const val TYPE_REFERENCE = 0x01
    const val TYPE_STRING = 0x03
    const val TYPE_DYNAMIC_REFERENCE = 0x07
    const val TYPE_INT_BOOLEAN = 0x12

    private const val STRING_POOL = 0x0001
    private const val TABLE = 0x0002
    private const val XML = 0x0003
    private const val XML_START_ELEMENT = 0x0102
    private const val XML_END_ELEMENT = 0x0103
    private const val XML_RESOURCE_MAP = 0x0180
    private const val TABLE_PACKAGE = 0x0200
    private const val TABLE_TYPE = 0x0201

    private const val UTF8_FLAG = 0x100
    private const val NO_INDEX = -1

    private const val TYPE_FLAG_SPARSE = 0x01
    private const val TYPE_FLAG_OFFSET16 = 0x02
    private const val ENTRY_FLAG_COMPLEX = 0x0001
    private const val ENTRY_FLAG_COMPACT = 0x0008
    private const val NO_ENTRY_16 = 0xffff

    /** Bytes from the start of a package chunk to its key string pool offset. */
    private const val PACKAGE_KEY_STRINGS = 276

    /** Reads a binary XML file and returns its root element. */
    fun readXml(bytes: ByteArray): XmlElement {
        val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        val file = buffer.chunkAt(0, bytes.size)
        require(file.type == XML) { "not a binary XML file" }
        var pool: StringPool? = null
        var resourceIds = IntArray(0)
        val open = ArrayDeque<ElementBuilder>()
        var root: XmlElement? = null
        var offset = file.start + file.headerSize
        while (offset < file.end) {
            val chunk = buffer.chunkAt(offset, file.end)
            when (chunk.type) {
                STRING_POOL -> pool = buffer.stringPool(chunk)
                XML_RESOURCE_MAP ->
                    resourceIds = IntArray((chunk.size - chunk.headerSize) / 4) { buffer.getInt(chunk.start + chunk.headerSize + 4 * it) }
                XML_START_ELEMENT -> {
                    val strings = requireNotNull(pool) { "an element comes before the string pool" }
                    open.addLast(buffer.startElement(chunk, strings, resourceIds))
                }
                XML_END_ELEMENT -> {
                    val element = open.removeLastOrNull()?.build() ?: throw IllegalArgumentException("an element ends that never started")
                    if (open.isEmpty()) {
                        require(root == null) { "more than one root element" }
                        root = element
                    } else {
                        open.last().children += element
                    }
                }
            }
            offset = chunk.end
        }
        require(open.isEmpty()) { "an element never ends" }
        return root ?: throw IllegalArgumentException("no root element")
    }

    /**
     * Every value of the resource [resourceId] in a binary resource table,
     * one for each configuration that holds it, such as `xml` and `xml-v35`.
     * Fails if the table has no package with the resource's package ID.
     */
    fun resourceValues(table: ByteArray, resourceId: Int): List<ResourceValue> {
        val buffer = ByteBuffer.wrap(table).order(ByteOrder.LITTLE_ENDIAN)
        val file = buffer.chunkAt(0, table.size)
        require(file.type == TABLE) { "not a resource table" }
        val packageId = resourceId ushr 24
        var globalStrings: StringPool? = null
        var packageFound = false
        val values = mutableListOf<ResourceValue>()
        var offset = file.start + file.headerSize
        while (offset < file.end) {
            val chunk = buffer.chunkAt(offset, file.end)
            when (chunk.type) {
                STRING_POOL -> if (globalStrings == null) globalStrings = buffer.stringPool(chunk)
                TABLE_PACKAGE -> if (buffer.getInt(chunk.start + 8) == packageId) {
                    packageFound = true
                    val strings = requireNotNull(globalStrings) { "a package comes before the string pool" }
                    values += buffer.packageValues(chunk, resourceId, strings)
                }
            }
            offset = chunk.end
        }
        require(packageFound) { "no package 0x%02x in the resource table".format(packageId) }
        return values
    }

    private fun ByteBuffer.packageValues(chunk: Chunk, resourceId: Int, globalStrings: StringPool): List<ResourceValue> {
        val typeId = (resourceId ushr 16) and 0xff
        val entryIndex = resourceId and 0xffff
        val keys = stringPool(chunkAt(chunk.start + getInt(chunk.start + PACKAGE_KEY_STRINGS), chunk.end))
        val values = mutableListOf<ResourceValue>()
        var offset = chunk.start + chunk.headerSize
        while (offset < chunk.end) {
            val inner = chunkAt(offset, chunk.end)
            if (inner.type == TABLE_TYPE && u8(inner.start + 8) == typeId) {
                entryOffset(inner, entryIndex)?.let { values += entry(inner.start + getInt(inner.start + 16) + it, keys, globalStrings) }
            }
            offset = inner.end
        }
        return values
    }

    /** Where entry [index] starts, relative to the entries of a type chunk, or null if this configuration lacks it. */
    private fun ByteBuffer.entryOffset(type: Chunk, index: Int): Int? {
        val flags = u8(type.start + 9)
        val count = getInt(type.start + 12)
        val offsets = type.start + type.headerSize
        return when {
            flags and TYPE_FLAG_SPARSE != 0 -> (0 until count)
                .firstOrNull { u16(offsets + 4 * it) == index }
                ?.let { u16(offsets + 4 * it + 2) * 4 }
            index >= count -> null
            flags and TYPE_FLAG_OFFSET16 != 0 -> u16(offsets + 2 * index).takeIf { it != NO_ENTRY_16 }?.let { it * 4 }
            else -> getInt(offsets + 4 * index).takeIf { it != NO_INDEX }
        }
    }

    private fun ByteBuffer.entry(at: Int, keys: StringPool, globalStrings: StringPool): ResourceValue {
        val flags = u16(at + 2)
        val key: Int
        val type: Int
        val data: Int
        if (flags and ENTRY_FLAG_COMPACT != 0) {
            key = u16(at)
            type = flags ushr 8
            data = getInt(at + 4)
        } else {
            require(flags and ENTRY_FLAG_COMPLEX == 0) { "the resource is a bag of values, not one value" }
            key = getInt(at + 4)
            val value = at + u16(at)
            type = u8(value + 3)
            data = getInt(value + 4)
        }
        return ResourceValue(keys[key], type, data, if (type == TYPE_STRING) globalStrings[data] else null)
    }

    private fun ByteBuffer.startElement(chunk: Chunk, strings: StringPool, resourceIds: IntArray): ElementBuilder {
        val ext = chunk.start + chunk.headerSize
        val attributeStart = u16(ext + 8)
        val attributeSize = u16(ext + 10)
        val attributeCount = u16(ext + 12)
        val attributes = List(attributeCount) { index ->
            val at = ext + attributeStart + index * attributeSize
            val nameIndex = getInt(at + 4)
            val raw = getInt(at + 8)
            val type = u8(at + 15)
            val data = getInt(at + 16)
            XmlAttribute(
                namespace = strings.orNull(getInt(at)),
                name = strings[nameIndex],
                resourceId = resourceIds.getOrNull(nameIndex)?.takeIf { it != 0 },
                type = type,
                data = data,
                text = strings.orNull(raw) ?: if (type == TYPE_STRING) strings[data] else null,
            )
        }
        return ElementBuilder(strings[getInt(ext + 4)], attributes)
    }

    private class ElementBuilder(val name: String, val attributes: List<XmlAttribute>) {
        val children = mutableListOf<XmlElement>()
        fun build() = XmlElement(name, attributes, children.toList())
    }

    /** A chunk: its type, header size, start and size, all checked to lie inside its parent. */
    private class Chunk(val type: Int, val headerSize: Int, val start: Int, val size: Int) {
        val end get() = start + size
    }

    private fun ByteBuffer.chunkAt(offset: Int, limit: Int): Chunk {
        require(offset >= 0 && offset + 8 <= limit) { "a chunk at $offset runs past its end" }
        val type = u16(offset)
        val headerSize = u16(offset + 2)
        val size = getInt(offset + 4)
        require(headerSize >= 8 && size >= headerSize && size <= limit - offset) {
            "the chunk 0x%04x at %d has a header of %d and a size of %d".format(type, offset, headerSize, size)
        }
        return Chunk(type, headerSize, offset, size)
    }

    /** A string pool. Strings are decoded when asked for. */
    private class StringPool(private val buffer: ByteBuffer, private val chunk: Chunk) {
        private val count = buffer.getInt(chunk.start + 8)
        private val utf8 = buffer.getInt(chunk.start + 16) and UTF8_FLAG != 0
        private val stringsStart = chunk.start + buffer.getInt(chunk.start + 20)

        operator fun get(index: Int): String {
            require(index in 0 until count) { "string $index is not in a pool of $count" }
            val at = stringsStart + buffer.getInt(chunk.start + chunk.headerSize + 4 * index)
            require(at in chunk.start until chunk.end) { "string $index lies outside its pool" }
            return if (utf8) utf8String(at) else utf16String(at)
        }

        fun orNull(index: Int): String? = if (index == NO_INDEX) null else get(index)

        private fun utf8String(at: Int): String {
            var position = at + if (buffer.u8(at) and 0x80 != 0) 2 else 1
            val first = buffer.u8(position)
            val length = if (first and 0x80 != 0) ((first and 0x7f) shl 8) or buffer.u8(position + 1) else first
            position += if (first and 0x80 != 0) 2 else 1
            require(position + length <= chunk.end) { "a string runs past its pool" }
            return String(ByteArray(length) { buffer.get(position + it) }, Charsets.UTF_8)
        }

        private fun utf16String(at: Int): String {
            val first = buffer.u16(at)
            val length = if (first and 0x8000 != 0) ((first and 0x7fff) shl 16) or buffer.u16(at + 2) else first
            val position = at + if (first and 0x8000 != 0) 4 else 2
            require(position + 2 * length <= chunk.end) { "a string runs past its pool" }
            return String(CharArray(length) { buffer.u16(position + 2 * it).toChar() })
        }
    }

    private fun ByteBuffer.stringPool(chunk: Chunk): StringPool {
        require(chunk.type == STRING_POOL) { "expected a string pool, found chunk 0x%04x".format(chunk.type) }
        return StringPool(this, chunk)
    }

    private fun ByteBuffer.u8(at: Int): Int = get(at).toInt() and 0xff

    private fun ByteBuffer.u16(at: Int): Int = getShort(at).toInt() and 0xffff
}
