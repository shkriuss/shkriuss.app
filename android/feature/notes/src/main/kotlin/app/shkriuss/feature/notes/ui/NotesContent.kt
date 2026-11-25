package app.shkriuss.feature.notes.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import app.shkriuss.core.design.ShkCard
import app.shkriuss.core.design.ShkEmptyState
import app.shkriuss.core.design.ShkErrorState
import app.shkriuss.core.design.ShkExtendedFloatingActionButton
import app.shkriuss.core.design.ShkListDetailScaffold
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkSnackbarHostState
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextField
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.ShkWindowWidth
import app.shkriuss.feature.notes.NoteRowState
import app.shkriuss.feature.notes.NoteSearch
import app.shkriuss.feature.notes.NotesClock
import app.shkriuss.feature.notes.NotesListState
import app.shkriuss.feature.notes.R

/**
 * Notes and one note open (docs/apps/notes/spec.md, "Notes" and
 * "Search"), by the width of the window:
 *
 * - Under 840dp, the list alone, and a tapped note in its place, with
 *   Back.
 * - From 840dp, `ShkListDetailScaffold`: the list, 360dp wide, and the open
 *   note beside it, or "Choose a note.".
 *
 * **New note** opens the note it made room for. The [snackbar] shows on
 * the screen in front: the open note, or the list once it closes, and
 * beside the list from 840dp.
 */
@Composable
internal fun NotesContent(models: NotesModels, snackbar: ShkSnackbarHostState, windowWidth: ShkWindowWidth = ShkWindowWidth.current) {
    val list = models.list.state.collectAsState()
    val open by models.open.open.collectAsState()
    // Only the note to open is read here, so the two panes are not drawn again at each key of a search.
    val newNote by remember { derivedStateOf { list.value.newNote } }
    LaunchedEffect(newNote) {
        val id = newNote ?: return@LaunchedEffect
        models.open.open(id, isNew = true)
        models.list.newNoteOpened()
    }
    val twoPanes = windowWidth == ShkWindowWidth.Expanded
    ShkListDetailScaffold(
        detailOpen = open != null,
        onCloseDetail = models.open::close,
        list = { ListPane(models, openNoteId = open?.model?.noteId?.takeIf { twoPanes }, snackbar = snackbar.takeIf { !twoPanes }) },
        detail = { onBack ->
            val note = open
            if (note == null) {
                ShkScreen(snackbarHostState = snackbar) {
                    ShkEmptyState(title = stringResource(R.string.notes_choose_a_note), modifier = Modifier.weight(1f))
                }
            } else {
                // Each note opens at its top, with a state of its own, and its pickers' launchers.
                key(note.paneKey) { OpenNotePane(note, models, snackbar, onBack) }
            }
        },
        windowWidth = windowWidth,
    )
}

/**
 * The list: the search field, the notes in their sections, and the
 * floating button **New note**. Back with text in the field clears it.
 * From 840dp the note open beside it, [openNoteId], is marked.
 */
@Composable
private fun ListPane(models: NotesModels, openNoteId: String?, snackbar: ShkSnackbarHostState?) {
    val list = models.list
    val screen by list.state.collectAsState()
    val query = screen.typed
    val clock by models.now.reading.collectAsState()
    val format = rememberNotesFormat()
    BackHandler(enabled = query.isNotEmpty()) { list.clearSearch() }
    var buttonHeight by remember { mutableIntStateOf(0) }
    ShkScreen(
        topBar = { ShkTopBar(title = stringResource(R.string.notes_notes)) },
        floatingActionButton = {
            ShkExtendedFloatingActionButton(
                text = stringResource(R.string.notes_new_note),
                icon = painterResource(R.drawable.notes_icon_add),
                onClick = list::newNote,
                modifier = Modifier.onSizeChanged { buttonHeight = it.height },
            )
        },
        snackbarHostState = snackbar,
    ) {
        ShkTextField(
            value = query,
            onValueChange = list::search,
            label = stringResource(R.string.notes_search),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            // What is searched is the user's own text: the keyboard is asked not to learn it (spec, "Search", point 4).
            keyboardLearns = false,
        )
        when (val shown = screen.list) {
            NotesListState.Loading -> Unit
            NotesListState.Failed -> ShkErrorState(title = stringResource(R.string.notes_could_not_open), modifier = Modifier.weight(1f))
            is NotesListState.Shown -> when {
                shown.noMatch -> ShkEmptyState(
                    title = stringResource(R.string.notes_no_match, shown.query),
                    modifier = Modifier.weight(1f),
                    announce = true,
                )
                shown.noNotes -> ShkEmptyState(
                    title = stringResource(R.string.notes_no_notes),
                    body = stringResource(R.string.notes_no_notes_body),
                    modifier = Modifier.weight(1f),
                )
                else -> {
                    val room = with(LocalDensity.current) { buttonHeight.toDp() } + ShkSpacing.Large
                    val onOpen = { row: NoteRowState -> models.open.open(row.note.id) }
                    val headings = shown.pinned.isNotEmpty()
                    // With no heading above it, the first row keeps the distance from the search field that the rows keep from
                    // each other.
                    if (!headings) Spacer(Modifier.height(ShkSpacing.Small))
                    LazyColumn(
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(ShkSpacing.Small),
                    ) {
                        val pinned = if (headings) R.string.notes_pinned else null
                        val others = if (headings) R.string.notes_other_notes else null
                        noteSection(pinned, PINNED_KEY, shown.pinned, openNoteId, clock, format, onOpen)
                        noteSection(others, OTHERS_KEY, shown.others, openNoteId, clock, format, onOpen)
                        item(key = ROOM_KEY) { Spacer(Modifier.height(room)) }
                    }
                }
            }
        }
    }
}

/** One section of the list: its heading, if any, and its rows. */
private fun LazyListScope.noteSection(
    heading: Int?,
    key: String,
    rows: List<NoteRowState>,
    openNoteId: String?,
    clock: NotesClock,
    format: NotesFormat,
    onOpen: (NoteRowState) -> Unit,
) {
    if (rows.isEmpty()) return
    if (heading != null) item(key = key) { ShkSectionHeader(stringResource(heading)) }
    items(rows, key = { it.note.id }) { row -> NoteCard(row, selected = row.note.id == openNoteId, clock, format) { onOpen(row) } }
}

/**
 * One row of the list (spec, "Notes", point 3, and "Search", point 2): the
 * title, up to two lines of the text, or the line or the file that
 * matches a search with the match in bold, and the last change with the
 * number of files. TalkBack reads it as one item: "Trip, pinned, changed
 * Monday 16 November, 2 files, Passport, Tickets". The card of the note
 * open beside the list is [selected] (the owner's decision).
 */
@Composable
private fun NoteCard(row: NoteRowState, selected: Boolean, clock: NotesClock, format: NotesFormat, onOpen: () -> Unit) {
    val colors = ShkTheme.colors
    val title = row.title.ifEmpty { stringResource(R.string.notes_empty_note) }
    val titleMatch = row.match?.inTitle.orEmpty().takeIf { row.note.title.isNotEmpty() }.orEmpty()
    val line = row.match?.line
    val fileName = row.match?.fileName
    val under: String
    val underBold: List<IntRange>
    when {
        line != null -> {
            // From a little before the match when it is far into the line, so it stays in the two lines a row shows.
            val shown = NoteSearch.shownLine(line)
            under = shown.line
            underBold = shown.ranges
        }
        fileName != null -> {
            under = stringResource(R.string.notes_file_match, fileName)
            // The matches in the name, where the name stands in the words "File: ticket.jpg".
            val at = under.lastIndexOf(fileName)
            underBold = if (at < 0) emptyList() else row.match.inFileName.map { it.first + at..it.last + at }
        }
        else -> {
            under = row.preview
            underBold = emptyList()
        }
    }
    val change = format.lastChange(row.note.lastChange, clock)
    val files = pluralStringResource(R.plurals.notes_file_count, row.fileCount, format.number(row.fileCount))
    val meta = if (row.fileCount == 0) change else stringResource(R.string.notes_row_meta, change, files)
    val resources = LocalResources.current
    val spoken = listOfNotNull(
        title,
        stringResource(R.string.notes_spoken_pinned).takeIf { row.note.pinned },
        stringResource(R.string.notes_spoken_changed, format.spokenChange(row.note.lastChange, clock)),
        files.takeIf { row.fileCount > 0 },
        under.takeIf { it.isNotEmpty() },
    ).reduce { said, next -> resources.getString(R.string.notes_spoken_parts, said, next) }
    ShkCard(onClick = onOpen, modifier = Modifier.semantics { contentDescription = spoken }, selected = selected) {
        ShkText(text = title, style = ShkTextStyle.Subtitle, bold = titleMatch)
        if (under.isNotEmpty()) {
            ShkText(text = under, color = colors.textSecondary, maxLines = PREVIEW_LINES, bold = underBold)
        }
        ShkText(text = meta, style = ShkTextStyle.Caption, color = colors.textSecondary)
    }
}

/** The lines of a note's text that a row shows. */
private const val PREVIEW_LINES = 2

/** The keys of the headings and the room under the last row. No note has them as its `id`. */
private const val PINNED_KEY = "pinned"
private const val OTHERS_KEY = "others"
private const val ROOM_KEY = "room-for-button"
