package app.shkriuss.feature.notes

import app.shkriuss.feature.notes.data.AttachmentEntity
import app.shkriuss.feature.notes.data.NoteEntity

/** What the order of the list needs of a note (docs/apps/notes/spec.md, "Notes", point 2). */
interface Listed {
    /** The record's `id`. */
    val id: String

    /** True if it is pinned. */
    val pinned: Boolean

    /** When it was made, in milliseconds since 1970 UTC. */
    val createdAt: Long

    /** Its last change, `updatedAt`, in milliseconds since 1970 UTC. Adding or removing a file moves it too. */
    val lastChange: Long
}

/** One note as the screens show it: a shown note, not deleted (docs/apps/notes/spec.md, "Words used on this page"). */
data class Note(
    override val id: String,
    /** The title, as stored. */
    val title: String,
    /** The text, with its marks, as stored. */
    val body: String,
    override val pinned: Boolean,
    override val createdAt: Long,
    override val lastChange: Long,
    /** The change number of the stored record, so that a press acts only on what it showed. */
    val changeNumber: Long,
) : Listed

/** One shown file of a note: its record, without its key. The key stays in the repository. */
data class NoteFile(
    /** The record's `id`, which also names its stream. */
    val id: String,
    /** The `id` of its note. */
    val noteId: String,
    /** Its name, as the picker gave it. */
    val name: String,
    /** Its type, such as `image/jpeg`. */
    val mimeType: String,
    /** Its length in bytes, before encryption. */
    val size: Long,
    /** When it was added, in milliseconds since 1970 UTC. */
    val createdAt: Long,
) {
    /** True if its type starts with `image/`: Notes then tries to show it ("Showing an image", point 1). */
    val maybeImage: Boolean
        get() = mimeType.startsWith("image/")
}

/** The note of the stored row [row]. */
internal fun noteOf(row: NoteEntity): Note =
    Note(row.record.id, row.title, row.body, row.pinned, row.record.createdAt, row.record.updatedAt, row.changeNumber)

/** The file of the stored row [row]. */
internal fun fileOf(row: AttachmentEntity): NoteFile =
    NoteFile(row.record.id, row.noteId, row.name, row.mimeType, row.size, row.record.createdAt)

/**
 * The order of the list and of the files of a note (docs/apps/notes/spec.md,
 * "Notes", point 2, and "A note", point 4).
 */
object NoteOrder {
    /** By last change, newest first. Ties: `createdAt`, then `id`. */
    val NOTES: Comparator<Listed> = compareByDescending<Listed> { it.lastChange }.thenBy { it.createdAt }.thenBy { it.id }

    /** The files of a note: oldest first, by `createdAt`, then `id`. */
    val FILES: Comparator<NoteFile> = compareBy<NoteFile> { it.createdAt }.thenBy { it.id }

    /** The pinned notes and the others, each in [NOTES] order. Without a pinned note, [Sections.pinned] is empty and the list has no heading. */
    fun <T : Listed> sections(notes: List<T>): Sections<T> {
        val (pinned, others) = notes.sortedWith(NOTES).partition { it.pinned }
        return Sections(pinned, others)
    }
}

/** The two sections of the list: **Pinned** and **Other notes**. */
data class Sections<T : Listed>(val pinned: List<T>, val others: List<T>) {
    /** True if the list shows the two headings: there is a pinned note. */
    val hasHeadings: Boolean
        get() = pinned.isNotEmpty()
}

/**
 * What a row of the list shows of a note (docs/apps/notes/spec.md, "Notes",
 * point 3): the title, or the first line of the text without its marks,
 * or nothing, for "Empty note"; and up to two lines of the text, marks
 * removed and line breaks as spaces. The screen cuts it with "…".
 *
 * A row keeps no more than [NoteLimits.MOST_ROW_TEXT] characters of its
 * note's text, each time as a text of its own: the list holds a row for
 * every note, and every whole text at once is more than the app's memory
 * holds.
 */
object NoteRow {
    /**
     * The title the row shows, or "" for "Empty note". With no title it is
     * the first line of the text that holds more than a mark or spaces, so
     * a text that starts with an empty line is not "Empty note": its first
     * [NoteLimits.MOST_ROW_TEXT] characters.
     */
    fun title(note: Note): String =
        note.title.ifEmpty { NoteText.first(NoteFormatting.firstLineWithText(note.body), NoteLimits.MOST_ROW_TEXT) }

    /**
     * The text the row keeps under the title: the first
     * [NoteLimits.MOST_ROW_TEXT] characters of the text, marks removed and
     * line breaks as spaces. The screen shows two lines of it.
     */
    fun preview(note: Note): String = NoteText.first(NoteFormatting.plain(note.body).trim(), NoteLimits.MOST_ROW_TEXT)
}
