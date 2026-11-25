package app.shkriuss.feature.notes.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import app.shkriuss.core.design.ShkIconButton
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkMenu
import app.shkriuss.core.design.ShkMenuItem
import app.shkriuss.core.design.ShkProgressBar
import app.shkriuss.core.design.ShkSectionHeader
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.feature.notes.AddingFile
import app.shkriuss.feature.notes.FileRowState
import app.shkriuss.feature.notes.FileState
import app.shkriuss.feature.notes.NoteImages
import app.shkriuss.feature.notes.NoteState
import app.shkriuss.feature.notes.NoteViewModel
import app.shkriuss.feature.notes.R
import app.shkriuss.core.design.R as DesignR

/**
 * The files of a note, under its text (docs/apps/notes/spec.md, "A
 * note", point 4): the heading "Files", one row per shown file, oldest
 * first, and one row for each file that waits to be added or is being
 * added, "Adding ticket.jpg", with a progress bar when its size is known.
 */
@Composable
internal fun FilesSection(state: NoteState, model: NoteViewModel, images: NoteImages, actions: FileActions, format: NotesFormat) {
    ShkSectionHeader(stringResource(R.string.notes_files))
    state.files.forEach { row -> FileRow(row, images, actions, format, onDamage = model::checkFilesAgain) }
    state.adding.forEach { adding -> AddingRow(adding, format) }
}

/**
 * The row of one file: a small image for an image that can be shown, a
 * file icon otherwise; the name; under it the size, or why it cannot be
 * opened; and at the end **More**, with **Save a copy** and **Remove**. A
 * tap on an image opens the image view; on another file, the same menu. A
 * file that cannot be opened offers only **Remove**.
 *
 * TalkBack reads the row as one item, "ticket.jpg, image, 2.4 megabytes",
 * or with its state, and offers its actions: "Open" for an image, "Save a
 * copy" and "Remove". The small image has no label, and **More** is not a
 * TalkBack item of its own: its actions are the row's. The image is
 * decoded in memory while the row shows, and goes with it.
 */
@Composable
private fun FileRow(row: FileRowState, images: NoteImages, actions: FileActions, format: NotesFormat, onDamage: () -> Unit) {
    val file = row.file
    val side = with(LocalDensity.current) { THUMBNAIL_SIDE.roundToPx() }
    val thumbnail by produceState<ImageBitmap?>(null, file.id, row.state, side) {
        value = null
        if (row.state != FileState.READY || !file.maybeImage) return@produceState
        val decoded = images.decode(file, side)
        // A read that met damage marks the file damaged: its row says so.
        if (decoded == null) onDamage()
        value = decoded?.asImageBitmap()
    }
    val image = thumbnail
    val ready = row.state == FileState.READY
    var menuOpen by remember { mutableStateOf(false) }
    val saveCopy = stringResource(R.string.notes_save_copy)
    val remove = stringResource(R.string.notes_remove)
    val openWords = stringResource(R.string.notes_open)
    val under = fileStateText(row.state) ?: format.size(file.size)
    val resources = LocalResources.current
    val spoken = listOfNotNull(
        file.name,
        stringResource(R.string.notes_spoken_image).takeIf { image != null },
        fileStateText(row.state) ?: format.spokenSize(file.size),
    ).reduce { said, next -> resources.getString(R.string.notes_spoken_parts, said, next) }
    val spokenActions = buildList {
        if (image != null) add(CustomAccessibilityAction(openWords) { actions.openImage(file).let { true } })
        if (ready) add(CustomAccessibilityAction(saveCopy) { actions.saveCopy(file).let { true } })
        add(CustomAccessibilityAction(remove) { actions.remove(file).let { true } })
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        ShkListItem(
            headline = file.name,
            supportingText = under,
            icon = painterResource(R.drawable.notes_icon_file),
            image = image?.let { remember(it) { BitmapPainter(it) } },
            onClick = { if (image != null) actions.openImage(file) else menuOpen = true },
            modifier = Modifier
                .weight(1f)
                .semantics {
                    contentDescription = spoken
                    customActions = spokenActions
                },
        )
        Box {
            ShkIconButton(
                icon = painterResource(DesignR.drawable.shk_icon_more),
                contentDescription = stringResource(R.string.notes_more),
                onClick = { menuOpen = true },
                // TalkBack offers its actions on the row, which it reads as one item.
                modifier = Modifier.semantics { hideFromAccessibility() },
            )
            ShkMenu(
                expanded = menuOpen,
                onDismissRequest = { menuOpen = false },
                items = buildList {
                    if (ready) add(ShkMenuItem(text = saveCopy, onClick = { actions.saveCopy(file) }))
                    add(ShkMenuItem(text = remove, onClick = { actions.remove(file) }, destructive = true))
                },
            )
        }
    }
}

/** The row of a file that waits to be added or is being added: "Adding ticket.jpg", and its progress bar once its size is known. */
@Composable
private fun AddingRow(adding: AddingFile, format: NotesFormat) {
    val words = adding.name?.let { stringResource(R.string.notes_adding, it) } ?: stringResource(R.string.notes_adding_a_file)
    Column(Modifier.fillMaxWidth()) {
        ShkListItem(headline = words, icon = painterResource(R.drawable.notes_icon_file))
        val total = adding.total
        if (total != null && total > 0) {
            val fraction = (adding.done.toFloat() / total).coerceIn(0f, 1f)
            ShkProgressBar(
                value = fraction,
                label = words,
                valueText = format.percent(fraction),
                modifier = Modifier.padding(bottom = ShkSpacing.Small),
            )
        }
    }
}

/** The side of the small image of a file, as the list item draws it at font scale 1.0. */
private val THUMBNAIL_SIDE = 40.dp
