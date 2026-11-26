package app.shkriuss.feature.notes

import app.shkriuss.feature.notes.data.AttachmentEntity
import app.shkriuss.feature.notes.data.NoteEntity

/** The limits and counts of docs/apps/notes/spec.md, "Limits and defaults" and "Data". */
object NoteLimits {
    /** **New note** adds no note while this many are shown. A restore can bring more. */
    const val MOST_NOTES: Int = 5_000

    /** The longest title, in code points. */
    const val MOST_TITLE: Int = 200

    /** The longest text, in code points. */
    const val MOST_BODY: Int = 100_000

    /**
     * How many code points of its note's text a row of the list keeps: the
     * text under the title, the title of a note that has none of its own,
     * and the line that matches a search. A row shows two lines of it.
     */
    const val MOST_ROW_TEXT: Int = 1_000

    /**
     * How many notes are read at a time where Notes reads all of them: the
     * list, a search and a backup. Each can hold [MOST_BODY] characters,
     * and every text at once is more than the app's memory holds.
     */
    const val NOTES_AT_A_TIME: Int = 20

    /** **Add a file** adds no file to a note that holds this many. A restore can bring more. */
    const val MOST_FILES_PER_NOTE: Int = 20

    /**
     * **Add a file** looks at and tries at most this many files of one
     * pick, twice the 21 that may wait at a time (decided by the owner).
     * The rest are told as not added.
     */
    const val MOST_FILES_TRIED_PER_PICK: Int = 2 * (MOST_FILES_PER_NOTE + 1)

    /** The largest file, in bytes: 25 MB. */
    const val MOST_FILE_BYTES: Long = 25_000_000L

    /** The bytes of all files that are not deleted: 1 GB. A restore can bring more. */
    const val MOST_ALL_FILE_BYTES: Long = 1_000_000_000L

    /** The longest file name, in code points. A longer one keeps its first 255. */
    const val MOST_NAME: Int = 255

    /** The shortest and the longest type, in characters. */
    val TYPE_LENGTH: IntRange = 3..127

    /** The type of a file whose type from the picker is outside the limits. */
    const val UNKNOWN_TYPE: String = "application/octet-stream"

    /** The lengths a wrapped file key can have. */
    val WRAPPED_KEY_LENGTH: IntRange = 50..1_024

    /** How every wrapped file key starts: `SHK`, version 1, kind 4 (crypto-design.md, kind 4). */
    val WRAPPED_KEY_START: ByteArray = byteArrayOf(0x53, 0x48, 0x4B, 0x01, 0x04)

    /** The largest number a numbered item can have. */
    const val MOST_ITEM_NUMBER: Int = 99_999
}

/**
 * How the title and the text are kept from what is typed or pasted
 * (docs/apps/notes/spec.md, "A note", point 7): line breaks are stored as
 * `\n`, and in the title they become spaces; tabs stay in the text; every
 * other control character is removed. Spaces at both ends of the title go
 * when it is saved ([savedTitle]).
 */
object NoteText {
    /** [typed] as the title field keeps it: on one line, with no control character. */
    fun title(typed: String): String = buildString(typed.length) {
        var index = 0
        while (index < typed.length) {
            val char = typed[index]
            when {
                char == '\r' && typed.getOrNull(index + 1) == '\n' -> {
                    append(' ')
                    index++
                }
                char.isLineBreak() -> append(' ')
                char.isControl() -> Unit
                else -> append(char)
            }
            index++
        }
    }

    /** The title as it is stored: [title] without the spaces at either end. */
    fun savedTitle(typed: String): String = title(typed).trim()

    /** [typed] as the text field keeps it: `\r\n`, `\r` and the line and paragraph separators become `\n`, and no control character but `\n` and tab. */
    fun body(typed: String): String = buildString(typed.length) {
        var index = 0
        while (index < typed.length) {
            val char = typed[index]
            when {
                char == '\r' && typed.getOrNull(index + 1) == '\n' -> {
                    append('\n')
                    index++
                }
                char == '\r' || char == '\n' || char == '\u2028' || char == '\u2029' -> append('\n')
                char == '\t' -> append(char)
                char.isControl() -> Unit
                else -> append(char)
            }
            index++
        }
    }

    /** The number of code points of [text]: what the limits count as characters. */
    fun length(text: String): Int = text.codePointCount(0, text.length)

    /** The first [most] code points of [text], as a text of its own, or [text] if it has no more. */
    fun first(text: String, most: Int): String =
        if (length(text) > most) text.substring(0, text.offsetByCodePoints(0, most)) else text

    /** True for a character that ends a line in the title: the control characters and the line and paragraph separators. */
    private fun Char.isLineBreak(): Boolean = this == '\n' || this == '\r' || this == ' ' || this == ' '

    /** True for a control character of Unicode's general category Cc. */
    private fun Char.isControl(): Boolean = Character.getType(this) == Character.CONTROL.toInt()
}

/**
 * How the name and the type of a picked file are kept (docs/apps/notes/spec.md,
 * "Adding a file", point 3).
 */
object FileText {
    /**
     * The name as stored, from the picker's: line breaks and control
     * characters become spaces, it keeps its first 255 code points, the
     * spaces at both ends go, and a name that is then empty becomes
     * [unnamed], the word "File" of the app's strings.
     */
    fun name(picked: String?, unnamed: String): String {
        val spaced = buildString((picked ?: "").length) {
            (picked ?: "").forEach { char -> append(if (char.isControlOrBreak()) ' ' else char) }
        }
        val kept = if (NoteText.length(spaced) > NoteLimits.MOST_NAME) {
            spaced.substring(0, spaced.offsetByCodePoints(0, NoteLimits.MOST_NAME))
        } else {
            spaced
        }
        return kept.trim().ifEmpty { unnamed }
    }

    /** The type as stored: the picker's, or `application/octet-stream` when it is outside the limits. */
    fun type(picked: String?): String = picked?.takeIf(::isType) ?: NoteLimits.UNKNOWN_TYPE

    /** True if [type] is within the limits: 3 to 127 characters, type `/` subtype, of lower-case ASCII letters, digits and `!#$&^_.+-`. */
    fun isType(type: String): Boolean = type.length in NoteLimits.TYPE_LENGTH && TYPE.matches(type)

    /** True if [name] is as a stored name is: 1 to 255 code points, with no control character or line break and no space at either end. */
    fun isName(name: String): Boolean =
        name.isNotEmpty() && name == name.trim() && NoteText.length(name) <= NoteLimits.MOST_NAME && name.none { it.isControlOrBreak() }

    private fun Char.isControlOrBreak(): Boolean =
        Character.getType(this) == Character.CONTROL.toInt() || this == ' ' || this == ' '

    private val TYPE = Regex("[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+")
}

/**
 * The limits of every column of the two tables, and the wiped form that
 * joins them (docs/apps/notes/spec.md, "Data", "The wiped form" and
 * "Every stored value has limits"). The repository never writes a row
 * outside them, and a restore refuses one.
 */
object NoteRules {
    /** True if the note [row] can be stored: within the limits. Its wiped form is within them. Its record fields are not checked here. */
    fun isStored(row: NoteEntity): Boolean = isTitle(row.title) && isBody(row.body) && row.fileChanges >= 0

    /**
     * True if the file [row] can be stored. A file that is not deleted is
     * within the limits; a deleted one is within them or exactly in the
     * wiped form, never partly wiped. Its record fields are not checked
     * here.
     */
    fun isStored(row: AttachmentEntity): Boolean {
        if (!isId(row.noteId)) return false
        val withinLimits = FileText.isName(row.name) &&
            FileText.isType(row.mimeType) &&
            row.size in 0..NoteLimits.MOST_FILE_BYTES &&
            isWrappedKey(row.wrappedKey)
        return withinLimits || (row.record.deletedAt != null && isWiped(row))
    }

    /** True if the title [title] is as stored: 0 to 200 code points, one line, no control character, no space at either end. */
    fun isTitle(title: String): Boolean =
        NoteText.length(title) <= NoteLimits.MOST_TITLE && title == NoteText.savedTitle(title)

    /** True if the text [body] is as stored: 0 to 100,000 code points, no control character but `\n` and tab. */
    fun isBody(body: String): Boolean = NoteText.length(body) <= NoteLimits.MOST_BODY && body == NoteText.body(body)

    /** True if [key] can be a wrapped file key: 50 to 1,024 bytes, starting with `53 48 4B 01 04`. */
    fun isWrappedKey(key: ByteArray): Boolean =
        key.size in NoteLimits.WRAPPED_KEY_LENGTH &&
            NoteLimits.WRAPPED_KEY_START.indices.all { key[it] == NoteLimits.WRAPPED_KEY_START[it] }

    /** True if [id] is 36 characters, lower case, a version 4 UUID, as `IdSource.RandomUuid` makes them. */
    fun isId(id: String): Boolean = UUID_V4.matches(id)

    /** The note [row] in its wiped form: empty, not pinned, and no file changes counted. */
    fun wiped(row: NoteEntity): NoteEntity = row.copy(title = "", body = "", pinned = false, fileChanges = 0)

    /** The file [row] in its wiped form: only the `id` of its note is kept. */
    fun wiped(row: AttachmentEntity): AttachmentEntity = row.copy(name = "", mimeType = "", size = 0, wrappedKey = ByteArray(0))

    /** True if the note [row] is in its wiped form. A note that is not deleted can be too: an empty note. */
    fun isWiped(row: NoteEntity): Boolean = row == wiped(row)

    /** True if the file [row] is in its wiped form. A file that is not deleted never is. */
    fun isWiped(row: AttachmentEntity): Boolean = row == wiped(row)

    /** The next value of `fileChanges`: one more, and 0 after 2,147,483,647, so that each change still writes the note. */
    fun nextFileChanges(current: Int): Int = if (current == Int.MAX_VALUE) 0 else current + 1

    private val UUID_V4 = Regex("[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
}
