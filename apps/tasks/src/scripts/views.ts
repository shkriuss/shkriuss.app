/**
 * Tasks: what's shown, chosen with the chips under the heading: all tasks,
 * the important ones, or one list's (with how many are still to do in
 * each). Split from tasks.ts (audit 5 J-3).
 */
import { required } from '@shkriuss/ui/dom';
import { listName, sortedLists, type List, type ListsState } from '../lib/lists.ts';
import { inView, openPerList, tasksCount, type TasksState, type View } from '../lib/tasks.ts';

const keyOf = (view: View): string => (typeof view === 'string' ? view : `list:${view.list}`);
const viewOf = (key: string): View =>
  key === 'all' || key === 'important' ? key : { list: key.slice('list:'.length) };

/** What the switcher needs from the page (tasks.ts). */
export interface ViewsPage {
  tasks(): TasksState;
  lists(): ListsState;
  /** Another view was tapped: the page draws it from its first page. */
  chosen(): void;
  announce(text: string): void;
}

export interface Views {
  /** What's shown now. */
  view(): View;
  /** Shows another view (drawn at the next draw). */
  set(view: View): void;
  /** "All tasks", "Important", or the list's name. */
  name(view?: View): string;
  /** How many tasks are still to do in a view. */
  openCount(view: View): number;
  /** Draws the chips, the heading and "Rename or delete this list". */
  render(): void;
  /** The heading: where focus goes when there's nowhere better. */
  heading: HTMLElement;
}

export function mountViews(root: Document, page: ViewsPage): Views {
  const heading = required<HTMLElement>(root, '[data-view-heading]');
  const viewList = required<HTMLUListElement>(root, '[data-views]');
  const editListButton = required<HTMLButtonElement>(root, '[data-action="edit-list"]');
  const viewTemplate = required<HTMLTemplateElement>(root, '[data-view-template]');

  let view: View = 'all';

  const name = (shown: View = view): string =>
    shown === 'all'
      ? 'All tasks'
      : shown === 'important'
        ? 'Important'
        : listName(page.lists(), shown.list);
  const openCount = (shown: View): number =>
    page.tasks().tasks.filter((task) => task.done === null && inView(task, shown)).length;

  function renderChips(): void {
    const perList = openPerList(page.tasks());
    const choices: { view: View; name: string; count: number }[] = [
      { view: 'all', name: 'All', count: openCount('all') },
      { view: 'important', name: 'Important', count: openCount('important') },
      ...sortedLists(page.lists()).map((list: List) => ({
        view: { list: list.id },
        name: list.name,
        count: perList.get(list.id) ?? 0,
      })),
    ];
    // Keep focus on the same choice when the buttons are made again.
    const focused = (root.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-view]')
      ?.dataset['view'];
    viewList.replaceChildren(
      ...choices.map((choice) => {
        const fragment = viewTemplate.content.cloneNode(true) as DocumentFragment;
        const entry = required<HTMLLIElement>(fragment, 'li');
        const button = required<HTMLButtonElement>(entry, '[data-view]');
        button.dataset['view'] = keyOf(choice.view);
        button.setAttribute('aria-pressed', String(keyOf(choice.view) === keyOf(view)));
        required<HTMLElement>(entry, '[data-view-name]').textContent = choice.name;
        required<HTMLElement>(entry, '[data-view-count]').textContent = String(choice.count);
        return entry;
      }),
    );
    if (focused) {
      viewList.querySelector<HTMLElement>(`[data-view="${CSS.escape(focused)}"]`)?.focus();
    }
  }

  viewList.addEventListener('click', (event) => {
    const key = (event.target as Element).closest<HTMLElement>('[data-view]')?.dataset['view'];
    if (key === undefined) return;
    view = viewOf(key);
    page.chosen();
    page.announce(`${name(view)}: ${tasksCount(openCount(view))} to do.`);
  });

  return {
    view: () => view,
    set(next) {
      view = next;
    },
    name,
    openCount,
    render() {
      // A list deleted (here or on another device) can't stay shown.
      if (typeof view !== 'string' && listName(page.lists(), view.list) === '') view = 'all';
      renderChips();
      heading.textContent = name(view);
      editListButton.hidden = typeof view === 'string';
    },
    heading,
  };
}
