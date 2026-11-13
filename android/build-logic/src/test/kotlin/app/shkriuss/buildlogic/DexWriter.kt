package app.shkriuss.buildlogic

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Writes small dex files for the tests: a header, the string IDs, the type
 * IDs and the method IDs, which is all [DexMethodReferences] reads, and the
 * strings themselves. Rules 7 and 8 search every byte, so a name among the
 * strings is found as it would be in a real dex file.
 */
internal object DexWriter {
    private const val HEADER_SIZE = 0x70

    /**
     * A dex file that names [types] (descriptors such as `Landroid/webkit/WebView;`),
     * refers to [methods] (owner descriptor and name), and holds [texts] as
     * further strings.
     */
    fun dex(
        types: List<String> = emptyList(),
        methods: List<Pair<String, String>> = emptyList(),
        texts: List<String> = emptyList(),
        version: String = "039",
    ): ByteArray {
        val allTypes = (types + methods.map { it.first }).distinct()
        val strings = (allTypes + methods.map { it.second } + texts).distinct()
        val stringIds = HEADER_SIZE
        val typeIds = stringIds + 4 * strings.size
        val methodIds = typeIds + 4 * allTypes.size
        val stringData = methodIds + 8 * methods.size

        val data = ByteArrayOutputStream()
        val stringOffsets = strings.map { string ->
            val offset = stringData + data.size()
            uleb128(string.length).forEach { data.write(it.toInt()) }
            data.write(string.toByteArray(Charsets.UTF_8))
            data.write(0)
            offset
        }
        val file = ByteBuffer.allocate(stringData + data.size()).order(ByteOrder.LITTLE_ENDIAN)
        file.put("dex\n$version\u0000".toByteArray(Charsets.US_ASCII))
        file.putInt(0x20, stringData + data.size())
        file.putInt(0x24, HEADER_SIZE)
        file.putInt(0x28, 0x12345678)
        file.putInt(0x38, strings.size).putInt(0x3c, stringIds)
        file.putInt(0x40, allTypes.size).putInt(0x44, typeIds)
        file.putInt(0x58, methods.size).putInt(0x5c, methodIds)
        stringOffsets.forEachIndexed { index, offset -> file.putInt(stringIds + 4 * index, offset) }
        allTypes.forEachIndexed { index, type -> file.putInt(typeIds + 4 * index, strings.indexOf(type)) }
        methods.forEachIndexed { index, (owner, name) ->
            file.putShort(methodIds + 8 * index, allTypes.indexOf(owner).toShort())
            file.putShort(methodIds + 8 * index + 2, 0)
            file.putInt(methodIds + 8 * index + 4, strings.indexOf(name))
        }
        file.position(stringData)
        file.put(data.toByteArray())
        return file.array()
    }

    private fun uleb128(value: Int): List<Byte> {
        val bytes = mutableListOf<Byte>()
        var rest = value
        do {
            var byte = rest and 0x7f
            rest = rest ushr 7
            if (rest != 0) byte = byte or 0x80
            bytes += byte.toByte()
        } while (rest != 0)
        return bytes
    }
}
