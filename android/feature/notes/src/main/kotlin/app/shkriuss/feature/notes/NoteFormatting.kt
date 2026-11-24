package app.shkriuss.feature.notes

/** The mark at the start of a line (docs/apps/notes/spec.md, "Formatting"). */
enum class LineKind {
    /** `# `: the line is a heading. */
    HEADING,

    /** `- `: a bullet. */
    BULLET,

    /** A number from 1 to 99,999, `.` and a space: a numbered item. */
    NUMBERED,

    /** `- [ ] `: an open checklist item. */
    OPEN_ITEM,

    /** `- [x] ` or `- [X] `: a done checklist item. */
    DONE_ITEM,
}

/** The mark that starts one line: what it is, how long it is, and the number of a numbered item. */
data class LineMark(val kind: LineKind, val length: Int, val number: Int = 0)

/** What a range of the text shows as. The screen gives each its style; showing never changes the text. */
enum class Look {
    /** A mark: in the secondary text colour. */
    MARK,

    /** A heading line: in the heading style. */
    HEADING,

    /** Bold, between `**` marks. */
    BOLD,

    /** Italic, between `*` marks. */
    ITALIC,

    /** The text of a done item: in the secondary colour, struck through. */
    DONE,
}

/** One range of the text, from [start] to [end], not included, with its [look]. */
data class LookRange(val look: Look, val start: Int, val end: Int)

/** A text and its selection, from [start] to [end]. With no selection they are the same: the cursor. */
data class TextEdit(val text: String, val start: Int, val end: Int = start)

/**
 * The marks of the text, as in Markdown, and what the formatting bar,
 * Enter and a tap on a box do with them (docs/apps/notes/spec.md,
 * "Formatting"). Plain code: the text field shows what [looks] gives, and
 * hands each change to the functions here.
 */
object NoteFormatting {
    /** The mark at the very start of [line], or null. A checklist mark is read before a bullet. */
    fun lineMark(line: String): LineMark? = when {
        line.startsWith("# ") -> LineMark(LineKind.HEADING, 2)
        line.startsWith("- [ ] ") -> LineMark(LineKind.OPEN_ITEM, 6)
        line.startsWith("- [x] ") || line.startsWith("- [X] ") -> LineMark(LineKind.DONE_ITEM, 6)
        line.startsWith("- ") -> LineMark(LineKind.BULLET, 2)
        else -> NUMBER.find(line)?.let { match ->
            LineMark(LineKind.NUMBERED, match.value.length, match.groupValues[1].toInt())
        }
    }

    /** The ranges of [text] with their looks: the marks, heading lines, bold, italic and the text of done items. */
    fun looks(text: String): List<LookRange> = buildList {
        forEachLine(text) { lineStart, line ->
            val mark = lineMark(line)
            if (mark != null) {
                add(LookRange(Look.MARK, lineStart, lineStart + mark.length))
                when (mark.kind) {
                    LineKind.HEADING -> add(LookRange(Look.HEADING, lineStart, lineStart + line.length))
                    LineKind.DONE_ITEM -> if (line.length > mark.length) add(LookRange(Look.DONE, lineStart + mark.length, lineStart + line.length))
                    else -> Unit
                }
            }
            inlineMarks(line).forEach { inline ->
                val look = if (inline.markLength == 2) Look.BOLD else Look.ITALIC
                add(LookRange(Look.MARK, lineStart + inline.start, lineStart + inline.start + inline.markLength))
                add(LookRange(look, lineStart + inline.start + inline.markLength, lineStart + inline.end - inline.markLength))
                add(LookRange(Look.MARK, lineStart + inline.end - inline.markLength, lineStart + inline.end))
            }
        }
    }

    /**
     * The boxes of the checklist items of [text]: the ranges of `[ ]`,
     * `[x]` and `[X]`. A tap on one ticks its item or opens it again
     * ([toggleBox]).
     */
    fun boxes(text: String): List<IntRange> = buildList {
        forEachLine(text) { lineStart, line ->
            val kind = lineMark(line)?.kind
            if (kind == LineKind.OPEN_ITEM || kind == LineKind.DONE_ITEM) add(lineStart + 2..lineStart + 4)
        }
    }

    /** [text] with the item whose box starts at [boxStart] ticked, or opened again. The same text if no box starts there. */
    fun toggleBox(text: String, boxStart: Int): String {
        val box = boxes(text).firstOrNull { it.first == boxStart } ?: return text
        val inside = text[box.first + 1]
        return text.replaceRange(box.first + 1, box.first + 2, if (inside == ' ') "x" else " ")
    }

    /**
     * The checklist item that the cursor at [cursor] is on: true for a done
     * item, false for an open one, null for a line that is no item. TalkBack
     * then offers "Tick" or "Open again".
     */
    fun itemAt(text: String, cursor: Int): Boolean? = when (lineMark(lineAt(text, cursor).second)?.kind) {
        LineKind.OPEN_ITEM -> false
        LineKind.DONE_ITEM -> true
        else -> null
    }

    /** True if every line that [edit]'s cursor or selection touches has a mark of [kind]: the button of the bar is on. */
    fun isOn(edit: TextEdit, kind: LineKind): Boolean = touchedLines(edit).all { (_, line) ->
        val found = lineMark(line)?.kind
        found == kind || (kind == LineKind.OPEN_ITEM && found == LineKind.DONE_ITEM)
    }

    /**
     * **Heading** or **Bulleted list**: adds the mark of [kind] to each line
     * that [edit] touches, in place of another line mark, or removes it
     * when every such line has it.
     */
    fun toggleLineMark(edit: TextEdit, kind: LineKind): TextEdit {
        require(kind == LineKind.HEADING || kind == LineKind.BULLET) { "Only a heading or a bullet" }
        val prefix = if (kind == LineKind.HEADING) "# " else "- "
        val remove = touchedLines(edit).all { (_, line) -> lineMark(line)?.kind == kind }
        return changeLines(edit) { _, mark -> if (remove) "" else if (mark?.kind == kind) null else prefix }
    }

    /** **Numbered list**: numbers the lines that [edit] touches 1, 2, 3, or removes their marks when every one is numbered already. */
    fun toggleNumbers(edit: TextEdit): TextEdit {
        val remove = touchedLines(edit).all { (_, line) -> lineMark(line)?.kind == LineKind.NUMBERED }
        return changeLines(edit) { index, _ -> if (remove) "" else "${index + 1}. " }
    }

    /** **Checklist**: a line that is no item becomes an open item; an open item is ticked; a done item is opened again. */
    fun toggleChecklist(edit: TextEdit): TextEdit = changeLines(edit) { _, mark ->
        when (mark?.kind) {
            LineKind.OPEN_ITEM -> "- [x] "
            LineKind.DONE_ITEM -> "- [ ] "
            else -> "- [ ] "
        }
    }

    /**
     * **Bold** or **Italic**, with [marks] `**` or `*`: puts the marks around
     * the selection, or takes them away when they are exactly around it.
     * With no selection, both marks go in at the cursor, and the cursor
     * between them. The selection keeps the same text.
     */
    fun toggleInline(edit: TextEdit, marks: String): TextEdit {
        val text = edit.text
        val start = minOf(edit.start, edit.end)
        val end = maxOf(edit.start, edit.end)
        val size = marks.length
        val around = start >= size && end + size <= text.length &&
            text.regionMatches(start - size, marks, 0, size) && text.regionMatches(end, marks, 0, size)
        return when {
            start != end && around -> TextEdit(
                text.substring(0, start - size) + text.substring(start, end) + text.substring(end + size),
                start - size,
                end - size,
            )
            else -> TextEdit(text.substring(0, start) + marks + text.substring(start, end) + marks + text.substring(end), start + size, end + size)
        }
    }

    /**
     * What Enter does after [before] became [after] by one `\n` typed at the
     * cursor, or null when it does nothing more (spec, "Formatting", point
     * 5). At the end of a bullet, a numbered item or a checklist item, the
     * next line starts with the same mark: the next number, an open box.
     * On an item with no text after its mark, the mark goes, and so does
     * the new line. After item 99,999 the line starts with no mark.
     */
    fun afterEnter(before: TextEdit, after: TextEdit): TextEdit? {
        val at = before.start
        if (before.start != before.end || after.start != after.end || after.start != at + 1) return null
        if (after.text != before.text.substring(0, at) + "\n" + before.text.substring(at)) return null
        val (lineStart, line) = lineAt(before.text, at)
        if (lineStart + line.length != at) return null
        val mark = lineMark(line) ?: return null
        if (mark.kind == LineKind.HEADING) return null
        if (line.length == mark.length) {
            return TextEdit(before.text.substring(0, lineStart) + before.text.substring(at), lineStart)
        }
        val next = when (mark.kind) {
            LineKind.BULLET -> "- "
            LineKind.NUMBERED -> if (mark.number >= NoteLimits.MOST_ITEM_NUMBER) "" else "${mark.number + 1}. "
            else -> "- [ ] "
        }
        if (next.isEmpty()) return null
        val text = after.text.substring(0, at + 1) + next + after.text.substring(at + 1)
        return TextEdit(text, at + 1 + next.length)
    }

    /**
     * [text] for a row of the list: marks removed and each line break as a
     * space. The line marks go, and the marks of bold and italic that count.
     */
    fun plain(text: String): String = buildString(text.length) {
        forEachLine(text) { lineStart, line ->
            if (lineStart > 0) append(' ')
            append(plainLine(line))
        }
    }

    /** One line without its line mark and the inline marks that count. */
    fun plainLine(line: String): String {
        val marks = inlineMarks(line)
        val skip = BooleanArray(line.length)
        lineMark(line)?.let { mark -> for (index in 0 until mark.length) skip[index] = true }
        marks.forEach { inline ->
            for (index in inline.start until inline.start + inline.markLength) skip[index] = true
            for (index in inline.end - inline.markLength until inline.end) skip[index] = true
        }
        return buildString(line.length) { line.forEachIndexed { index, char -> if (!skip[index]) append(char) } }
    }

    /** The first line of [text], or "" for an empty text. */
    fun firstLine(text: String): String = text.substringBefore('\n')

    /** Calls [action] with the start and the text of each line of [text], `\n` not included. An empty text has one empty line. */
    internal inline fun forEachLine(text: String, action: (lineStart: Int, line: String) -> Unit) {
        var start = 0
        while (true) {
            val end = text.indexOf('\n', start).let { if (it < 0) text.length else it }
            action(start, text.substring(start, end))
            if (end == text.length) return
            start = end + 1
        }
    }

    /** The bold and italic marks of one [line] that count: each from [InlineMark.start] to [InlineMark.end], marks included. */
    internal fun inlineMarks(line: String): List<InlineMark> = buildList {
        val bold = Closers(line, "**")
        val italic = Closers(line, "*")
        var index = 0
        while (index < line.length) {
            if (line[index] != '*') {
                index++
                continue
            }
            val found = bold.closing(index) ?: italic.closing(index)
            if (found == null) {
                index++
            } else {
                add(found)
                index = found.end
            }
        }
    }

    /**
     * The places in [line] where [marks] can close a mark: each follows a
     * character that is not a space. They are found once for the line, so
     * a line full of marks that close nothing takes one pass, not one pass
     * for each mark.
     */
    private class Closers(private val line: String, private val marks: String) {
        private val places: IntArray = buildList {
            var at = line.indexOf(marks, 1)
            while (at >= 0) {
                if (line[at - 1] != ' ') add(at)
                at = line.indexOf(marks, at + 1)
            }
        }.toIntArray()

        /**
         * The mark [marks] that opens at [open] and the nearest one that
         * closes it: the opening mark is followed by a character that is
         * not a space, and the closing one follows such a character.
         */
        fun closing(open: Int): InlineMark? {
            val size = marks.length
            if (!line.regionMatches(open, marks, 0, size)) return null
            val first = open + size
            if (first >= line.length || line[first] == ' ') return null
            val found = places.binarySearch(first + 1).let { if (it < 0) -it - 1 else it }
            return if (found < places.size) InlineMark(open, places[found] + size, size) else null
        }
    }

    /** The lines that [edit]'s cursor or selection touches, each with its start. */
    private fun touchedLines(edit: TextEdit): List<Pair<Int, String>> {
        val from = minOf(edit.start, edit.end)
        val to = maxOf(edit.start, edit.end)
        return buildList {
            forEachLine(edit.text) { lineStart, line ->
                if (lineStart <= to && lineStart + line.length >= from) add(lineStart to line)
            }
        }
    }

    /**
     * Gives each line that [edit] touches the line mark [newMark] returns
     * for it, in place of the mark it has: "" for none, null to keep the
     * line as it is. The cursor and the selection move with the text.
     */
    private fun changeLines(edit: TextEdit, newMark: (index: Int, mark: LineMark?) -> String?): TextEdit {
        val touched = touchedLines(edit).map { it.first }.toSet()
        val text = StringBuilder(edit.text.length + 16)
        val moves = mutableListOf<LineMove>()
        var index = 0
        forEachLine(edit.text) { lineStart, line ->
            if (lineStart > 0) text.append('\n')
            val mark = lineMark(line)
            val replacement = if (lineStart in touched) newMark(index++, mark) else null
            val oldLength = if (replacement == null) 0 else mark?.length ?: 0
            moves += LineMove(lineStart, lineStart + line.length, text.length, oldLength, replacement?.length ?: 0)
            if (replacement == null) text.append(line) else text.append(replacement).append(line, oldLength, line.length)
        }
        return TextEdit(text.toString(), movedPosition(edit.start, moves), movedPosition(edit.end, moves))
    }

    /** One line of [changeLines]: where it started and ended, where it starts now, and the length of its old and its new mark. */
    private class LineMove(val oldStart: Int, val oldEnd: Int, val newStart: Int, val oldMark: Int, val newMark: Int)

    /** Where [position] of the old text is in the new one. Inside an old mark it goes after the new mark. */
    private fun movedPosition(position: Int, moves: List<LineMove>): Int {
        val line = moves.first { position <= it.oldEnd }
        val offset = position - line.oldStart
        return line.newStart + line.newMark + (offset - line.oldMark).coerceAtLeast(0)
    }

    /** The start and the text of the line that holds [position]. */
    private fun lineAt(text: String, position: Int): Pair<Int, String> {
        val start = if (position <= 0) 0 else text.lastIndexOf('\n', position - 1) + 1
        val end = text.indexOf('\n', start).let { if (it < 0) text.length else it }
        return start to text.substring(start, end)
    }

    private val NUMBER = Regex("^([1-9][0-9]{0,4})\\. ")
}

/** One bold or italic mark pair of a line, from [start] to [end], marks included. [markLength] is 2 for bold, 1 for italic. */
internal data class InlineMark(val start: Int, val end: Int, val markLength: Int)
