package app.shkriuss.feature.notes.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import app.shkriuss.core.design.ShkDivider
import app.shkriuss.core.design.ShkEditorAction
import app.shkriuss.core.design.ShkErrorState
import app.shkriuss.core.design.ShkIconButton
import app.shkriuss.core.design.ShkMenuItem
import app.shkriuss.core.design.ShkProgressDialog
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSnackbarHostState
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkText
import app.shkriuss.core.design.ShkTextEditor
import app.shkriuss.core.design.ShkTextLook
import app.shkriuss.core.design.ShkTextRange
import app.shkriuss.core.design.ShkTextStyle
import app.shkriuss.core.design.ShkTheme
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.ShkTopBarAction
import app.shkriuss.feature.notes.ChosenDocument
import app.shkriuss.feature.notes.FieldProblem
import app.shkriuss.feature.notes.LineKind
import app.shkriuss.feature.notes.Look
import app.shkriuss.feature.notes.NoteDocuments
import app.shkriuss.feature.notes.NoteFile
import app.shkriuss.feature.notes.NoteFormatting
import app.shkriuss.feature.notes.NoteLimits
import app.shkriuss.feature.notes.NoteState
import app.shkriuss.feature.notes.NoteViewModel
import app.shkriuss.feature.notes.OpenNote
import app.shkriuss.feature.notes.PickedDocument
import app.shkriuss.feature.notes.R
import app.shkriuss.feature.notes.TextEdit

/**
 * The open note, or the image view of one of its files in its place
 * (docs/apps/notes/spec.md, "A note" and "The image view"). The two
 * screens of Android's file picker are opened here, for both: **Add a
 * file**, and **Save a copy**. A second press while a picker is open does
 * nothing, so one picker opens. [onBack] closes the note, under 840dp.
 */
@Composable
internal fun OpenNotePane(open: OpenNote, models: NotesModels, snackbar: ShkSnackbarHostState, onBack: (() -> Unit)?) {
    val model = open.model
    val state by model.state.collectAsState()
    val resolver = LocalContext.current.contentResolver
    var picking by rememberSaveable { mutableStateOf(false) }
    val addFiles = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        picking = false
        val picked = NoteDocuments.pickedOf(result.resultCode, result.data)
        if (picked.isNotEmpty()) model.addFiles(picked.map { PickedDocument(resolver, it) })
    }
    var copyOf by rememberSaveable { mutableStateOf<String?>(null) }
    val saveCopy = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val file = state.files.firstOrNull { it.file.id == copyOf }?.file
        copyOf = null
        val document = NoteDocuments.chosenOf(result.resultCode, result.data)
        if (file != null && document != null) model.saveCopy(file, ChosenDocument(resolver, document))
    }
    val actions = FileActions(
        add = {
            if (!picking) {
                picking = true
                addFiles.launch(NoteDocuments.addIntent())
            }
        },
        saveCopy = { file ->
            if (copyOf == null && state.copying == null) {
                copyOf = file.id
                saveCopy.launch(NoteDocuments.copyIntent(file.name, file.mimeType))
            }
        },
        remove = model::removeFile,
        openImage = { file -> models.open.openImage(file.id) },
    )

    val imageId = open.imageId
    val imageFile = state.files.firstOrNull { it.file.id == imageId }?.file
    if (imageId != null && imageFile != null) {
        ImageContent(imageFile, models.images, actions, snackbar, onBack = models.open::closeImage)
    } else {
        // The file of the image view was removed, here or by a restore: the note shows again.
        if (imageId != null && !state.loading) LaunchedEffect(imageId) { models.open.closeImage() }
        NoteScreen(state, model, open.isNew, models, actions, snackbar, onBack)
    }
    state.copying?.let { fraction -> ShkProgressDialog(text = stringResource(R.string.notes_saving_copy), fraction = fraction) }
}

/** What the rows of files and the image view can do: add files, save a copy, remove a file and open an image. */
internal class FileActions(
    val add: () -> Unit,
    val saveCopy: (NoteFile) -> Unit,
    val remove: (NoteFile) -> Unit,
    val openImage: (NoteFile) -> Unit,
)

/**
 * A note: the top bar with Back under 840dp, **Add a file** and the menu
 * with **Pin** or **Unpin** and **Delete note**; the line of a failed save;
 * the title; the text; and the files. While the text has the focus, the
 * formatting bar sits above the keyboard. A new note opens with the
 * keyboard in the text; a note that exists opens at its top.
 */
@Composable
private fun NoteScreen(
    state: NoteState,
    model: NoteViewModel,
    isNew: Boolean,
    models: NotesModels,
    actions: FileActions,
    snackbar: ShkSnackbarHostState,
    onBack: (() -> Unit)?,
) {
    val pin = stringResource(if (state.pinned) R.string.notes_unpin else R.string.notes_pin)
    val menu = listOf(
        ShkMenuItem(text = pin, onClick = { model.setPinned(state.pinned) }),
        ShkMenuItem(text = stringResource(R.string.notes_delete_note), onClick = model::delete, destructive = true),
    )
    val add = ShkTopBarAction(
        icon = painterResource(R.drawable.notes_icon_attach),
        label = stringResource(R.string.notes_add_file),
        onClick = actions.add,
    )
    ShkScreen(
        topBar = { ShkTopBar(title = "", onBack = onBack, actions = listOf(add), menuItems = menu) },
        snackbarHostState = snackbar,
    ) {
        when {
            state.loading -> Unit
            state.failed -> ShkErrorState(title = stringResource(R.string.notes_could_not_open), modifier = Modifier.weight(1f))
            else -> NoteFields(state, model, isNew, models, actions)
        }
    }
}

/** The fields and the files of a note, and the formatting bar under them while the text has the focus. */
@Composable
private fun androidx.compose.foundation.layout.ColumnScope.NoteFields(
    state: NoteState,
    model: NoteViewModel,
    isNew: Boolean,
    models: NotesModels,
    actions: FileActions,
) {
    val format = rememberNotesFormat()
    val text = remember { FocusRequester() }
    var textFocused by remember { mutableStateOf(false) }
    var keyboardOpened by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
        if (state.saveFailed) {
            ShkText(
                text = stringResource(R.string.notes_save_failed),
                color = ShkTheme.colors.error,
                modifier = Modifier
                    .padding(bottom = ShkSpacing.Small)
                    .semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        ShkTextEditor(
            text = state.title,
            onTextChange = model::onTitleChange,
            hint = stringResource(R.string.notes_title_hint),
            style = ShkTextStyle.Title,
            singleLine = true,
            errorText = if (state.problem == FieldProblem.TITLE_TOO_LONG) tooLong(R.plurals.notes_title_too_long, NoteLimits.MOST_TITLE, format) else null,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Next),
            keyboardActions = KeyboardActions(onNext = { text.requestFocus() }),
            // A note is the user's own text, as the titles of Reminders and Tasks are (spec, "A note", point 5).
            keyboardLearns = false,
        )
        BodyEditor(
            body = state.body,
            model = model,
            errorText = if (state.problem == FieldProblem.TEXT_TOO_LONG) tooLong(R.plurals.notes_text_too_long, NoteLimits.MOST_BODY, format) else null,
            modifier = Modifier
                .focusRequester(text)
                .onFocusChanged { textFocused = it.isFocused },
        )
        if (state.files.isNotEmpty() || state.adding.isNotEmpty()) {
            FilesSection(state, model, models.images, actions, format)
        }
    }
    if (textFocused) FormattingBar(state.body, model)
    LaunchedEffect(Unit) {
        // A new note opens with the keyboard in the text, once: not again when the phone is turned.
        if (isNew && !keyboardOpened) {
            keyboardOpened = true
            text.requestFocus()
        }
    }
}

/** "A title has at most 200 characters." or "A note has at most 100,000 characters.", in the phone's number format. */
@Composable
private fun tooLong(words: Int, most: Int, format: NotesFormat): String = pluralStringResource(words, most, format.number(most))

/**
 * The text of a note, formatted as it is typed: the marks in the secondary
 * colour, headings, bold, italic, and the text of a done item dimmed and
 * struck through. A tap on the box of an item ticks it or opens it again,
 * and the cursor does not move. While the cursor is on an item, TalkBack
 * offers "Tick" or "Open again".
 */
@Composable
private fun BodyEditor(body: TextEdit, model: NoteViewModel, errorText: String?, modifier: Modifier) {
    val looks = remember(body.text) { looksOf(body.text) }
    val boxes = remember(body.text) { NoteFormatting.boxes(body.text) }
    val item = NoteFormatting.itemAt(body.text, body.end)
    val action = item?.let { done ->
        val lineStart = if (body.end <= 0) 0 else body.text.lastIndexOf('\n', body.end - 1) + 1
        ShkEditorAction(stringResource(if (done) R.string.notes_open_again else R.string.notes_tick)) {
            model.toggleBox(lineStart + BOX_OFFSET)
        }
    }
    ShkTextEditor(
        text = body.text,
        selectionStart = body.start,
        selectionEnd = body.end,
        onChange = { text, start, end -> model.onBodyChange(TextEdit(text, start, end)) },
        hint = stringResource(R.string.notes_text_hint),
        modifier = modifier,
        looks = looks,
        tapRanges = boxes,
        onTapRange = { box -> model.toggleBox(box.first) },
        action = action,
        errorText = errorText,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        keyboardLearns = false,
    )
}

/** The looks of [text] for the editor. The text of a done item is dimmed and struck through. */
private fun looksOf(text: String): List<ShkTextRange> = NoteFormatting.looks(text).flatMap { range ->
    when (range.look) {
        Look.MARK -> listOf(ShkTextRange(ShkTextLook.Quiet, range.start, range.end))
        Look.HEADING -> listOf(ShkTextRange(ShkTextLook.Heading, range.start, range.end))
        Look.BOLD -> listOf(ShkTextRange(ShkTextLook.Bold, range.start, range.end))
        Look.ITALIC -> listOf(ShkTextRange(ShkTextLook.Italic, range.start, range.end))
        Look.DONE -> listOf(
            ShkTextRange(ShkTextLook.Quiet, range.start, range.end),
            ShkTextRange(ShkTextLook.StruckThrough, range.start, range.end),
        )
    }
}

/**
 * The formatting bar (spec, "Formatting", point 4): one row of 48dp icon
 * buttons above the keyboard, which scrolls sideways when it does not fit.
 * TalkBack reads each by its name, and whether it is on for the line
 * where the cursor is.
 */
@Composable
private fun FormattingBar(body: TextEdit, model: NoteViewModel) {
    val looks = remember(body.text) { NoteFormatting.looks(body.text) }
    val from = minOf(body.start, body.end)
    val to = maxOf(body.start, body.end)
    val inside = { look: Look -> looks.any { it.look == look && it.start <= from && to <= it.end } }
    Column(Modifier.fillMaxWidth()) {
        ShkDivider()
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
            BarButton(R.drawable.notes_icon_heading, R.string.notes_heading, NoteFormatting.isOn(body, LineKind.HEADING), model::heading)
            BarButton(R.drawable.notes_icon_bold, R.string.notes_bold, inside(Look.BOLD), model::bold)
            BarButton(R.drawable.notes_icon_italic, R.string.notes_italic, inside(Look.ITALIC), model::italic)
            BarButton(R.drawable.notes_icon_bullets, R.string.notes_bullets, NoteFormatting.isOn(body, LineKind.BULLET), model::bullets)
            BarButton(R.drawable.notes_icon_numbers, R.string.notes_numbers, NoteFormatting.isOn(body, LineKind.NUMBERED), model::numbers)
            BarButton(R.drawable.notes_icon_checklist, R.string.notes_checklist, NoteFormatting.isOn(body, LineKind.OPEN_ITEM), model::checklist)
        }
    }
}

/** One button of the formatting bar, read by its [label] and "On" or "Off". */
@Composable
private fun BarButton(icon: Int, label: Int, on: Boolean, onClick: () -> Unit) {
    val state = stringResource(if (on) R.string.notes_on else R.string.notes_off)
    ShkIconButton(
        icon = painterResource(icon),
        contentDescription = stringResource(label),
        onClick = onClick,
        modifier = Modifier.semantics { stateDescription = state },
    )
}

/** Where the box `[ ]` of a checklist item starts in its line, after `- `. */
private const val BOX_OFFSET = 2
