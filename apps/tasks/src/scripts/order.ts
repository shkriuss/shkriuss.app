/**
 * Tasks in your own order ("My order"): a task is moved by dragging its
 * handle (pointer events, so it works with a finger, a mouse or a pen), by
 * tapping the handle for "Move up" and "Move down", or with the arrow keys
 * on the handle. The order is the order of the saved tasks. Split from
 * tasks.ts (audit 5 J-3).
 */
import { moveTask, orderedTasks, type Task, type TasksState, type View } from '../lib/tasks.ts';

/** A handle has to move this far (px) before it counts as dragging, not a tap. */
const DRAG_START_PX = 6;
/** While dragging this close (px) to the top or bottom of the screen, it scrolls. */
const SCROLL_EDGE_PX = 64;
const SCROLL_STEP_PX = 16;

/** What moving tasks needs from the page (tasks.ts). */
export interface OrderPage {
  tasks(): TasksState;
  view(): View;
  /** What's typed in Search ("" for everything). */
  search(): string;
  find(id: string | null): Task | undefined;
  /** Saves and draws the list again; false if saving didn't work. */
  saveTasks(next: TasksState): boolean;
  /** Draws the list again (after a drag that was cancelled, say). */
  render(): void;
  /** Shows the task at the next draw, however far down it is. */
  keepShown(id: string): void;
  /** A task's control on the page, wherever it is. */
  control(id: string, selector: string): HTMLElement | null;
  announce(text: string): void;
}

export interface Order {
  /** The task showing Move up / Move down, if any. */
  moving(): string | null;
  /** Hides Move up / Move down (the order or the search changed). */
  reset(): void;
  /** The list was drawn again by something else: a drag under way ends. */
  drawn(): void;
}

/** Moving tasks in `groupsBox`, where the list in your own order is drawn. */
export function mountOrder(groupsBox: HTMLElement, page: OrderPage): Order {
  /** The task showing Move up / Move down, and the one being dragged. */
  let movingId: string | null = null;
  let drag: {
    id: string;
    row: HTMLElement;
    list: HTMLElement;
    pointerId: number;
    startY: number;
    moved: boolean;
  } | null = null;
  /** A drag ends with a click on the handle; that click isn't a tap. */
  let suppressClick = false;

  /** Moves a task, then puts focus back on the same control and says where it is. */
  function commitMove(
    task: Task,
    target: { before: string } | { after: string },
    focus: string,
  ): void {
    const next = moveTask(page.tasks(), task.id, target);
    page.keepShown(task.id);
    if (next !== page.tasks() && !page.saveTasks(next)) {
      page.control(task.id, focus)?.focus();
      return;
    }
    page.control(task.id, focus)?.focus();
    const ordered = orderedTasks(page.tasks(), page.view(), page.search());
    const position = ordered.findIndex((entry) => entry.id === task.id) + 1;
    page.announce(`${task.title}: ${position} of ${ordered.length}.`);
  }

  /** One place up (-1) or down (1) among the tasks shown. */
  function moveBy(task: Task, step: -1 | 1, focus: string): void {
    const ordered = orderedTasks(page.tasks(), page.view(), page.search());
    const neighbour = ordered[ordered.findIndex((entry) => entry.id === task.id) + step];
    if (!neighbour) {
      page.announce(
        step < 0 ? `${task.title} is first already.` : `${task.title} is last already.`,
      );
      return;
    }
    commitMove(task, step < 0 ? { before: neighbour.id } : { after: neighbour.id }, focus);
  }

  const taskOf = (element: Element): Task | undefined =>
    page.find(element.closest<HTMLElement>('[data-id]')?.dataset['id'] ?? null);

  groupsBox.addEventListener('pointerdown', (event) => {
    suppressClick = false;
    const handle = (event.target as Element).closest<HTMLElement>('[data-handle]');
    const row = handle?.closest<HTMLElement>('[data-id]');
    if (!handle || !row?.parentElement || event.button !== 0) return;
    drag = {
      id: row.dataset['id'] ?? '',
      row,
      list: row.parentElement,
      pointerId: event.pointerId,
      startY: event.clientY,
      moved: false,
    };
    handle.setPointerCapture(event.pointerId);
  });

  groupsBox.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.abs(event.clientY - drag.startY) < DRAG_START_PX) return;
      drag.moved = true;
      drag.row.classList.add('task--dragging');
      drag.list.classList.add('tasks--dragging');
    }
    event.preventDefault();
    // Past the middle of the task under the pointer: that task moves the
    // other way, so the dragged one (and its handle) stays where it is.
    for (const other of drag.list.children) {
      if (other === drag.row || !(other instanceof HTMLElement)) continue;
      const box = other.getBoundingClientRect();
      if (event.clientY < box.top || event.clientY > box.bottom) continue;
      const middle = box.top + box.height / 2;
      const above =
        (other.compareDocumentPosition(drag.row) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
      if (above && event.clientY < middle) drag.list.insertBefore(other, drag.row.nextSibling);
      else if (!above && event.clientY > middle) drag.list.insertBefore(other, drag.row);
      break;
    }
    // Near the top or bottom of the screen: scroll, to reach tasks out of view.
    // (Straight away, not smoothly, to keep up with the finger.)
    if (event.clientY < SCROLL_EDGE_PX) {
      window.scrollBy({ top: -SCROLL_STEP_PX, behavior: 'instant' });
    } else if (event.clientY > window.innerHeight - SCROLL_EDGE_PX) {
      window.scrollBy({ top: SCROLL_STEP_PX, behavior: 'instant' });
    }
  });

  function endDrag(event: PointerEvent, cancelled: boolean): void {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { id, row, list, moved } = drag;
    drag = null;
    row.classList.remove('task--dragging');
    list.classList.remove('tasks--dragging');
    // Not moved: a tap, and the click that follows shows Move up / Move down.
    if (!moved) return;
    suppressClick = true;
    const task = page.find(id);
    if (cancelled || !task) {
      page.render();
      return;
    }
    const next = (row.nextElementSibling as HTMLElement | null)?.dataset['id'];
    const previous = (row.previousElementSibling as HTMLElement | null)?.dataset['id'];
    if (next) commitMove(task, { before: next }, '[data-handle]');
    else if (previous) commitMove(task, { after: previous }, '[data-handle]');
  }

  groupsBox.addEventListener('pointerup', (event) => endDrag(event, false));
  groupsBox.addEventListener('pointercancel', (event) => endDrag(event, true));

  groupsBox.addEventListener('click', (event) => {
    const clicked = (event.target as Element).closest<HTMLElement>(
      '[data-handle], [data-action="move-up"], [data-action="move-down"]',
    );
    const task = clicked ? taskOf(clicked) : undefined;
    if (!clicked || !task) return;
    if (clicked.matches('[data-handle]')) {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      movingId = movingId === task.id ? null : task.id;
      page.render();
      page.control(task.id, movingId ? '[data-action="move-up"]' : '[data-handle]')?.focus();
      return;
    }
    const up = clicked.matches('[data-action="move-up"]');
    moveBy(task, up ? -1 : 1, up ? '[data-action="move-up"]' : '[data-action="move-down"]');
  });

  groupsBox.addEventListener('keydown', (event) => {
    const handle = (event.target as Element).closest<HTMLElement>('[data-handle]');
    const task = handle ? taskOf(handle) : undefined;
    if (!task || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    moveBy(task, event.key === 'ArrowUp' ? -1 : 1, '[data-handle]');
  });

  return {
    moving: () => movingId,
    reset() {
      movingId = null;
    },
    drawn() {
      // Changes from elsewhere end a drag.
      drag = null;
    },
  };
}
