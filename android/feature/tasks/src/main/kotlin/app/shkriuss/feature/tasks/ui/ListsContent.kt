package app.shkriuss.feature.tasks.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import app.shkriuss.core.design.ShkDialog
import app.shkriuss.core.design.ShkDialogAction
import app.shkriuss.core.design.ShkEmptyState
import app.shkriuss.core.design.ShkErrorState
import app.shkriuss.core.design.ShkExtendedFloatingActionButton
import app.shkriuss.core.design.ShkListDetailScaffold
import app.shkriuss.core.design.ShkListItem
import app.shkriuss.core.design.ShkMenuItem
import app.shkriuss.core.design.ShkScreen
import app.shkriuss.core.design.ShkSnackbarHostState
import app.shkriuss.core.design.ShkSpacing
import app.shkriuss.core.design.ShkTextField
import app.shkriuss.core.design.ShkTopBar
import app.shkriuss.core.design.ShkWindowWidth
import app.shkriuss.core.design.rememberShkSnackbarHostState
import app.shkriuss.feature.tasks.ListNameViewModel
import app.shkriuss.feature.tasks.ListQuestion
import app.shkriuss.feature.tasks.ListRow
import app.shkriuss.feature.tasks.ListScreen
import app.shkriuss.feature.tasks.ListViewModel
import app.shkriuss.feature.tasks.ListsScreen
import app.shkriuss.feature.tasks.ListsViewModel
import app.shkriuss.feature.tasks.NameDialog
import app.shkriuss.feature.tasks.NameProblem
import app.shkriuss.feature.tasks.R
import app.shkriuss.feature.tasks.TaskFormViewModel
import app.shkriuss.feature.tasks.TaskLimits
import app.shkriuss.feature.tasks.TaskRow

/**
 * Lists and one list open (docs/apps/tasks/spec.md, "Lists" and "A
 * list"), by the width of the window:
 *
 * - Under 840dp, Lists alone, and a tapped list in its place, with Back.
 * - From 840dp, `ShkListDetailScaffold`: Lists, 360dp wide, with the open
 *   list marked, and the open list beside it, or "Choose a list."
 *
 * The dialogs of **New list**, **Rename**, **Delete list** and **Delete
 * done tasks**, and the [form] of a task, a bottom sheet, are drawn over
 * both. The snackbars show on the screen in front: the open list, or
 * Lists once it closes, and beside Lists from 840dp.
 */
@Composable
internal fun ListsContent(
    lists: ListsViewModel,
    list: ListViewModel,
    names: ListNameViewModel,
    form: TaskFormViewModel,
    windowWidth: ShkWindowWidth = ShkWindowWidth.current,
) {
    val listsScreen by lists.state.collectAsState()
    val listScreen by list.state.collectAsState()
    val formScreen by form.state.collectAsState()
    val format = rememberTasksFormat()
    val snackbars = rememberShkSnackbarHostState()
    TasksSnackbarOn(snackbars, listScreen.snackbar, listScreen.today, format, list::undo, list::snackbarDismissed)
    TasksSnackbarOn(snackbars, formScreen.snackbar, listScreen.today, format, form::undo, form::snackbarDismissed)
    val twoPanes = windowWidth == ShkWindowWidth.Expanded
    ShkListDetailScaffold(
        detailOpen = listScreen.listId != null,
        onCloseDetail = list::close,
        list = {
            ListsPane(
                screen = listsScreen,
                openListId = listScreen.listId.takeIf { twoPanes },
                format = format,
                onOpen = { list.open(it.listId) },
                onNewList = names::openNew,
                // In one pane, Lists shows only while no list is open, and has the snackbars then.
                snackbars = snackbars.takeIf { !twoPanes },
            )
        },
        detail = { onBack -> ListPane(listScreen, list, names, form, format, snackbars, onBack) },
        windowWidth = windowWidth,
    )
    listScreen.question?.let { ListQuestionDialog(it, list, format) }
    names.state.collectAsState().value?.let { NameDialogContent(it, names, format) }
    TaskFormSheet(form, listScreen.today, format)
}

/**
 * Lists: Inbox first, then each list by name, each with its count of
 * open tasks, "4 open", and the floating button "New list". From 840dp
 * the list open beside it, [openListId], is marked.
 */
@Composable
private fun ListsPane(
    screen: ListsScreen,
    openListId: String?,
    format: TasksFormat,
    onOpen: (ListRow) -> Unit,
    onNewList: () -> Unit,
    snackbars: ShkSnackbarHostState?,
) {
    var buttonHeight by remember { mutableIntStateOf(0) }
    ShkScreen(
        topBar = { ShkTopBar(title = stringResource(R.string.tasks_lists)) },
        floatingActionButton = {
            ShkExtendedFloatingActionButton(
                text = stringResource(R.string.tasks_new_list),
                icon = painterResource(R.drawable.tasks_icon_add),
                onClick = onNewList,
                modifier = Modifier.onSizeChanged { buttonHeight = it.height },
            )
        },
        snackbarHostState = snackbars,
    ) {
        when {
            !screen.loaded -> Unit
            screen.failed -> ShkErrorState(title = stringResource(R.string.tasks_could_not_open), modifier = Modifier.weight(1f))
            else -> {
                val room = with(LocalDensity.current) { buttonHeight.toDp() } + ShkSpacing.Large
                val inbox = stringResource(R.string.tasks_inbox)
                LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                    items(screen.rows, key = { it.listId }) { row ->
                        ListItem(row, inbox, format, selected = row.listId == openListId) { onOpen(row) }
                    }
                    roomForButton(room)
                }
            }
        }
    }
}

/** One row of Lists: "Home", and "4 open" at its end. TalkBack reads it as one item: "Home, 4 open tasks". */
@Composable
private fun ListItem(row: ListRow, inbox: String, format: TasksFormat, selected: Boolean, onOpen: () -> Unit) {
    val name = row.list?.name ?: inbox
    val count = format.number(row.openCount)
    val spoken = stringResource(
        R.string.tasks_spoken_parts,
        name,
        pluralStringResource(R.plurals.tasks_open_count_spoken, row.openCount, count),
    )
    ShkListItem(
        headline = name,
        trailingText = pluralStringResource(R.plurals.tasks_open_count, row.openCount, count),
        onClick = onOpen,
        selected = selected,
        modifier = Modifier.semantics { contentDescription = spoken },
    )
}

/**
 * One list, or Inbox, or "Choose a list." beside Lists while none is
 * open: its name in the top bar, with its menu; the open tasks; the
 * section Done; and the floating button "Add a task", which opens the
 * [form] in this list with no due day. [onBack] closes it, under 840dp.
 */
@Composable
private fun ListPane(
    screen: ListScreen,
    model: ListViewModel,
    names: ListNameViewModel,
    form: TaskFormViewModel,
    format: TasksFormat,
    snackbars: ShkSnackbarHostState,
    onBack: (() -> Unit)?,
) {
    val listId = screen.listId
    if (listId == null) {
        ShkScreen(snackbarHostState = snackbars) {
            ShkEmptyState(title = stringResource(R.string.tasks_choose_a_list), modifier = Modifier.weight(1f))
        }
        return
    }
    // While the database cannot be read, the top bar keeps the name it showed.
    var title by remember(listId) { mutableStateOf("") }
    screen.list?.let { title = it.name }
    if (screen.isInbox) title = stringResource(R.string.tasks_inbox)
    var buttonHeight by remember { mutableIntStateOf(0) }
    ShkScreen(
        topBar = { ShkTopBar(title = title, onBack = onBack, menuItems = menuOf(screen, model, names)) },
        floatingActionButton = {
            ShkExtendedFloatingActionButton(
                text = stringResource(R.string.tasks_add),
                icon = painterResource(R.drawable.tasks_icon_add),
                onClick = { form.openNewIn(listId) },
                modifier = Modifier.onSizeChanged { buttonHeight = it.height },
            )
        },
        snackbarHostState = snackbars,
    ) {
        when {
            !screen.loaded -> Unit
            screen.failed -> ShkErrorState(title = stringResource(R.string.tasks_could_not_open), modifier = Modifier.weight(1f))
            screen.isEmpty -> ShkEmptyState(
                title = stringResource(R.string.tasks_list_empty_title),
                body = stringResource(R.string.tasks_list_empty_body),
                modifier = Modifier.weight(1f),
            )
            else -> {
                val room = with(LocalDensity.current) { buttonHeight.toDp() } + ShkSpacing.Large
                val done = stringResource(R.string.tasks_done)
                val item: @Composable (TaskRow) -> Unit = { row ->
                    TaskItem(
                        row = row,
                        place = RowPlace.LIST,
                        today = screen.today,
                        doneOn = screen.doneOn(row),
                        format = format,
                        onTick = { model.tick(row) },
                        onReopen = { model.reopen(row) },
                        onEdit = { form.openEdit(row.task) },
                    )
                }
                LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                    taskSection(heading = null, key = OPEN_KEY, rows = screen.open, item = item)
                    taskSection(heading = done, key = DONE_KEY, rows = screen.done, item = item)
                    roomForButton(room)
                }
            }
        }
    }
}

/** The menu of a list: **Rename** and **Delete list**, except on Inbox, and **Delete done tasks** while there are any. */
@Composable
private fun menuOf(screen: ListScreen, model: ListViewModel, names: ListNameViewModel): List<ShkMenuItem> {
    val rename = stringResource(R.string.tasks_rename)
    val deleteList = stringResource(R.string.tasks_delete_list)
    val deleteDone = stringResource(R.string.tasks_delete_done)
    return buildList {
        screen.list?.takeIf { screen.canRenameAndDelete }?.let { list ->
            add(ShkMenuItem(text = rename, onClick = { names.openRename(list) }))
            add(ShkMenuItem(text = deleteList, onClick = model::askDeleteList, destructive = true))
        }
        if (screen.canDeleteDone) add(ShkMenuItem(text = deleteDone, onClick = model::askDeleteDone, destructive = true))
    }
}

/**
 * The question of **Delete list**, "Delete the list Home?", "This deletes
 * 12 tasks." or "The list is empty.", or of **Delete done tasks**,
 * "Delete 12 done tasks?", with **Delete** and **Cancel**. Delete closes
 * it at the first press.
 */
@Composable
private fun ListQuestionDialog(question: ListQuestion, model: ListViewModel, format: TasksFormat) {
    val title: String
    val text: String?
    when (question) {
        is ListQuestion.DeleteList -> {
            title = stringResource(R.string.tasks_delete_list_question, question.list.name)
            text = if (question.taskCount == 0) {
                stringResource(R.string.tasks_delete_list_empty)
            } else {
                pluralStringResource(R.plurals.tasks_delete_list_text, question.taskCount, format.number(question.taskCount))
            }
        }
        is ListQuestion.DeleteDone -> {
            title = pluralStringResource(R.plurals.tasks_delete_done_question, question.count, format.number(question.count))
            text = null
        }
    }
    ShkDialog(
        title = title,
        text = text,
        confirmAction = ShkDialogAction(text = stringResource(R.string.tasks_delete), onClick = model::confirmDelete, destructive = true),
        dismissAction = ShkDialogAction(text = stringResource(R.string.tasks_cancel), onClick = model::cancelQuestion),
        onDismissRequest = model::cancelQuestion,
    )
}

/**
 * The dialog of **New list** or **Rename**, with one field, **Name**, and
 * **Save** and **Cancel**. Save checks the name first: a wrong name, the
 * 100 lists, or a write that failed, says so under the field, and the
 * dialog stays open with the name. The keyboard opens on the field.
 */
@Composable
private fun NameDialogContent(dialog: NameDialog, model: ListNameViewModel, format: TasksFormat) {
    val field = remember { FocusRequester() }
    ShkDialog(
        title = stringResource(if (dialog.listId == null) R.string.tasks_new_list else R.string.tasks_rename_list),
        confirmAction = ShkDialogAction(text = stringResource(R.string.tasks_save), onClick = model::save, closesDialog = false),
        dismissAction = ShkDialogAction(text = stringResource(R.string.tasks_cancel), onClick = {}),
        onDismissRequest = model::cancel,
    ) {
        ShkTextField(
            value = dialog.name,
            onValueChange = model::onNameChange,
            label = stringResource(R.string.tasks_name),
            errorText = dialog.problem?.let { nameProblemText(it, format) },
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { model.save() }),
            modifier = Modifier.focusRequester(field),
        )
        // In the dialog's own window, once the field is in it.
        LaunchedEffect(Unit) { field.requestFocus() }
    }
}

/** The words under the field Name. */
@Composable
private fun nameProblemText(problem: NameProblem, format: TasksFormat): String = when (problem) {
    NameProblem.EMPTY -> stringResource(R.string.tasks_name_empty)
    NameProblem.TOO_LONG -> {
        val most = TaskLimits.MOST_NAME_CODE_POINTS
        pluralStringResource(R.plurals.tasks_name_too_long, most, format.number(most))
    }
    NameProblem.TOO_MANY_LISTS -> {
        val most = TaskLimits.MOST_LISTS
        pluralStringResource(R.plurals.tasks_lists_limit, most, format.number(most))
    }
    NameProblem.COULD_NOT_SAVE -> stringResource(R.string.tasks_list_not_saved)
}

/** The keys of the two parts of a list. No task has them as its `id`. */
private const val OPEN_KEY = "open"
private const val DONE_KEY = "done"
