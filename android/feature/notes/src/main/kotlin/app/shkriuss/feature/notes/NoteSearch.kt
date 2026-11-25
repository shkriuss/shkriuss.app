package app.shkriuss.feature.notes

import java.util.Locale

/**
 * Search, as you type (docs/apps/notes/spec.md, "Search"). A note matches
 * when its title, its text or the name of one of its shown files holds
 * what was typed. Case is ignored: both sides are lower-cased by Unicode's
 * rules, the final sigma too, and a match keeps its place in the text.
 * Nothing else is folded: "e" does not match "é". Marks are text. There is
 * no index, and nothing of a search is stored.
 */
object NoteSearch {
    /** How [note], with the names of its shown [fileNames], matches [query], or null if it does not. An empty query matches nothing here. */
    fun match(note: Note, fileNames: List<String>, query: String): SearchMatch? {
        if (query.isEmpty()) return null
        val wanted = Lowered(query).text
        val inTitle = rangesIn(note.title, wanted)
        val line = matchingLine(note.body, wanted)
        val file = if (inTitle.isEmpty() && line == null) fileNames.firstOrNull { rangesIn(it, wanted).isNotEmpty() } else null
        if (inTitle.isEmpty() && line == null && file == null) return null
        return SearchMatch(inTitle, line, file, file?.let { rangesIn(it, wanted) }.orEmpty())
    }

    /** Every place where [wanted], lower-cased, stands in [text], each as a range of [text]. They do not overlap. */
    fun rangesIn(text: String, wanted: String): List<IntRange> {
        if (wanted.isEmpty()) return emptyList()
        val lowered = Lowered(text)
        return buildList {
            var from = 0
            while (true) {
                val at = lowered.text.indexOf(wanted, from)
                if (at < 0) break
                add(lowered.originalIndex(at)..lowered.originalEnd(at + wanted.length - 1) - 1)
                from = at + wanted.length
            }
        }
    }

    /** The first line of [body] that holds [wanted], as stored, with its matches, or null. */
    private fun matchingLine(body: String, wanted: String): MatchedLine? {
        NoteFormatting.forEachLine(body) { _, line ->
            val ranges = rangesIn(line, wanted)
            if (ranges.isNotEmpty()) return MatchedLine(line, ranges)
        }
        return null
    }

    /**
     * [original] lower-cased by Unicode's rules, as `String.lowercase`
     * does, with the place of each of its characters in [original].
     * Lower-casing a code point can change how many characters it takes,
     * so the places come from each code point lower-cased on its own. The
     * one rule that looks at the letters around, the final sigma, changes
     * a letter but never a length, so the places still fit the whole text
     * lower-cased.
     */
    private class Lowered(original: String) {
        val text: String
        private val starts: IntArray
        private val ends: IntArray

        init {
            val oneByOne = StringBuilder(original.length)
            val from = IntArray(original.length * 3 + 1)
            val to = IntArray(original.length * 3 + 1)
            var index = 0
            while (index < original.length) {
                val size = Character.charCount(original.codePointAt(index))
                val lower = original.substring(index, index + size).lowercase(Locale.ROOT)
                repeat(lower.length) {
                    from[oneByOne.length + it] = index
                    to[oneByOne.length + it] = index + size
                }
                oneByOne.append(lower)
                index += size
            }
            from[oneByOne.length] = original.length
            val whole = original.lowercase(Locale.ROOT)
            text = if (whole.length == oneByOne.length) whole else oneByOne.toString()
            starts = from
            ends = to
        }

        /** Where the code point that gave the character at [loweredIndex] starts in the original text. */
        fun originalIndex(loweredIndex: Int): Int = starts[loweredIndex]

        /** Where the code point that gave the character at [loweredIndex] ends in the original text, not included. */
        fun originalEnd(loweredIndex: Int): Int = ends[loweredIndex]
    }
}

/** A line of the text that matches a search, as stored, with the ranges of the match in it. */
data class MatchedLine(val line: String, val ranges: List<IntRange>)

/**
 * How a note matches a search. The row shows [line] under the title when
 * the text matches, or "File: ticket.jpg" for a match in [fileName] only.
 * A match in the title only shows the row as in the list. Each match is in
 * bold.
 */
data class SearchMatch(
    /** The matches in the stored title. */
    val inTitle: List<IntRange>,
    /** The first line of the text that matches, or null. */
    val line: MatchedLine?,
    /** The name of the first file that matches, when neither the title nor the text does. */
    val fileName: String?,
    /** The matches in [fileName]. */
    val inFileName: List<IntRange> = emptyList(),
)
