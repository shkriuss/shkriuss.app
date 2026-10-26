/**
 * Grammar's page behaviour: saves the text and settings on the device, sends
 * the text to the checker (checker.worker.ts, on this device) as it's typed,
 * and shows what it finds. Tapping a fix changes the text, as an edit Undo
 * can take back (edit-text.ts). Deep check, the optional AI model, is in
 * deep-check.ts. With sync on, the English choice and the dictionary sync
 * between devices; the text stays here.
 */
import { createStore } from '@shkriuss/storage';
import { createSync, syncedStore } from '@shkriuss/sync';
import { keepFocus } from '@shkriuss/ui/keep-focus';
import {
  clearProblem,
  reportSave,
  showProblem,
  type ReportSaveOptions,
} from '@shkriuss/ui/problem';
import { offlineCopySaved } from '@shkriuss/ui/service-worker';
import { mountSyncControls } from '@shkriuss/ui/sync-controls';
import { watchTextLimit } from '@shkriuss/ui/text-limit';
import { startWorker } from '@shkriuss/ui/worker';
import { site } from 'virtual:shkriuss/site';
import {
  addWord,
  applyFix,
  contextOf,
  dictionaryFull,
  emptyState,
  fixDone,
  fixesToShow,
  fixLabel,
  isGrammarState,
  MAX_SHOWN,
  MAX_WORDS,
  removeWord,
  summary,
  syncedSettings,
  withSyncedSettings,
  wordToAdd,
  type English,
  type FromChecker,
  type GrammarState,
  type Issue,
  type ToChecker,
} from '../lib/grammar.ts';
import checkerUrl from './checker.worker.ts?worker&url';
import { mountDeepCheck } from './deep-check.ts';
import { editText } from './edit-text.ts';
import { required } from '@shkriuss/ui/dom';

const store = createStore<GrammarState>({
  key: 'grammar',
  version: 1,
  fallback: () => emptyState(navigator.language),
  validate: isGrammarState,
});

/** Checks this long after the last key press. */
const CHECK_DELAY_MS = 400;
/** Saves this long after the last key press (and straight away when leaving). */
const SAVE_DELAY_MS = 500;

const LOADING = 'Loading the grammar checker…';
const EMPTY = 'Type or paste your text above, and suggestions show here.';
const FAILED = 'The grammar checker couldn’t start in this browser. Updating the browser may help.';

/** "“a”", or "the space" when the text is only spaces. */
const named = (text: string): string => (text.trim() === '' ? 'the space' : `“${text}”`);

export function mountGrammar(root: Document): void {
  const textarea = required<HTMLTextAreaElement>(root, '[data-text]');
  const radios = [...root.querySelectorAll<HTMLInputElement>('input[name="english"]')];
  const status = required<HTMLElement>(root, '[data-status]');
  const heading = required<HTMLElement>(root, '[data-suggestions-heading]');
  const list = required<HTMLUListElement>(root, '[data-issues]');
  const issueTemplate = required<HTMLTemplateElement>(root, '[data-issue-template]');
  const fixTemplate = required<HTMLTemplateElement>(root, '[data-fix-template]');
  const wordTemplate = required<HTMLTemplateElement>(root, '[data-word-template]');
  const wordList = required<HTMLUListElement>(root, '[data-words]');
  const dictionaryHeading = required<HTMLElement>(root, '[data-dictionary-heading]');
  const noWords = required<HTMLElement>(root, '[data-no-words]');
  const actionStatus = required<HTMLElement>(root, '[data-action-status]');
  const clearDialog = required<HTMLDialogElement>(root, '[data-clear-dialog]');
  const announcer = required<HTMLElement>(root, '[data-announcer]');
  // A paste longer than the box takes is cut by the browser: say so (audit F3-3).
  const textLimit = watchTextLimit(textarea);

  let state = store.load();
  /** What the checker found, and the text it found it in. */
  let issues: Issue[] = [];
  let checkedText: string | null = null;
  /** The newest check asked for, and its text. */
  let lastId = 0;
  let lastText = '';
  let phase: 'loading' | 'ready' | 'failed' = 'loading';
  /** After a fix: the suggestion to move to once the text is checked again. */
  let focusAfterCheck: number | null = null;
  let checkTimer: number | undefined;
  let saveTimer: number | undefined;
  /** True while a fix changes the text (see fixText). */
  let fixing = false;
  /** The note that the dictionary is full, while it's shown. */
  let fullNote: string | null = null;

  const announce = (message: string): void => {
    announcer.textContent = message;
  };
  /** After copy or clear: shown under the buttons, and read out. */
  const tellDone = (message: string): void => {
    actionStatus.textContent = message;
    announce(message);
  };
  const setStatus = (text: string): void => {
    // Only when it changes, so screen readers don't repeat it after every pause.
    if (status.textContent !== text) status.textContent = text;
  };

  /** Saves `next`; false (and the person is told) if it couldn't be saved. */
  function save(next: GrammarState, options?: ReportSaveOptions): boolean {
    state = next;
    return reportSave(store.save(state), options);
  }

  function saveText(): void {
    window.clearTimeout(saveTimer);
    // Saved after each pause in typing: a problem is read out once, not at every pause.
    if (textarea.value !== state.text) save({ ...state, text: textarea.value }, { repeat: false });
  }

  /**
   * Makes a fix as an edit, so Undo can take it back. The code making the
   * fix saves and checks the text itself, so the edit's `input` event is
   * left alone.
   */
  function fixText(text: string): void {
    fixing = true;
    try {
      editText(textarea, text);
    } finally {
      fixing = false;
    }
  }

  // ---------- The checker ----------

  let worker: Worker | undefined;
  const tell = (message: ToChecker): void => {
    worker?.postMessage(message);
  };

  function check(): void {
    window.clearTimeout(checkTimer);
    if (phase !== 'ready') return;
    const text = textarea.value;
    if (text.trim() === '') {
      // An answer for older text may still come: it no longer counts.
      lastId += 1;
      issues = [];
      checkedText = text;
      render();
      return;
    }
    lastId += 1;
    lastText = text;
    tell({ type: 'check', id: lastId, text });
  }

  function heard(event: MessageEvent<FromChecker>): void {
    const message = event.data;
    if (message.type === 'ready') {
      phase = 'ready';
      check();
    } else if (message.type === 'checked') {
      if (message.id !== lastId) return;
      issues = message.issues;
      checkedText = lastText;
      render();
    } else {
      checkerFailed();
    }
  }

  /** How many more times the checker is started again if it stops working. */
  let restarts = 3;

  /**
   * The checker stopped working. If it had started, it's started again, a
   * few times at most, and checks the text again once it's ready (audit
   * F3-4); if it never started, this browser can't run it.
   */
  function checkerFailed(): void {
    worker?.terminate();
    if (phase === 'ready' && restarts > 0) {
      restarts -= 1;
      phase = 'loading';
      startChecker();
      return;
    }
    phase = 'failed';
    setStatus(FAILED);
  }

  function startChecker(): void {
    worker = startWorker(checkerUrl);
    worker.addEventListener('message', heard);
    worker.addEventListener('error', checkerFailed);
    tell({ type: 'start', english: state.english, words: state.words });
  }

  // ---------- Showing what it found ----------

  function renderIssue(issue: Issue, index: number): HTMLLIElement {
    const fragment = issueTemplate.content.cloneNode(true) as DocumentFragment;
    const item = required<HTMLLIElement>(fragment, 'li');
    item.dataset['index'] = String(index);
    const context = contextOf(checkedText ?? '', issue);
    required<HTMLElement>(item, '[data-kind]').textContent = issue.label;
    required<HTMLElement>(item, '[data-before]').textContent = context.before;
    required<HTMLElement>(item, '[data-problem]').textContent = context.problem;
    required<HTMLElement>(item, '[data-after]').textContent = context.after;
    required<HTMLElement>(item, '[data-message]').textContent = issue.message;

    const fixes = required<HTMLElement>(item, '[data-fixes]');
    fixes.replaceChildren(
      ...fixesToShow(issue).map((fix, fixIndex) => {
        const button = required<HTMLButtonElement>(
          fixTemplate.content.cloneNode(true) as DocumentFragment,
          'button',
        );
        button.textContent = fixLabel(issue, fix);
        // Which fix it is goes in its value, not a data attribute, so that
        // keepFocus (in render) finds the button through its suggestion.
        button.value = String(fixIndex);
        return button;
      }),
    );
    fixes.hidden = fixes.childElementCount === 0;

    // Each name starts with the button's visible words, so people who use
    // voice control can say what they see (WCAG 2.5.3).
    required<HTMLElement>(item, '[data-action="show"]').setAttribute(
      'aria-label',
      `Show in text: ${named(issue.problem)}`,
    );
    const word = wordToAdd(issue);
    const addButton = required<HTMLButtonElement>(item, '[data-action="add-word"]');
    addButton.hidden = word === undefined || state.words.includes(word);
    if (word !== undefined) addButton.setAttribute('aria-label', `Add to my dictionary: “${word}”`);
    return item;
  }

  function render(): void {
    if (phase !== 'ready') return;
    const shown = issues.slice(0, MAX_SHOWN);
    const draw = (): void => {
      list.replaceChildren(...shown.map(renderIssue));
    };
    // After a fix, focus goes to the next suggestion (below). Otherwise the
    // text may have been checked again after a change in another tab or
    // device: focus stays on the same suggestion, or one near it (audit 3 G-1).
    if (focusAfterCheck === null) keepFocus(draw, heading);
    else draw();
    setStatus(textarea.value.trim() === '' ? EMPTY : summary(issues.length));

    if (focusAfterCheck !== null) {
      const items = list.querySelectorAll<HTMLElement>('li');
      const item = items[Math.min(focusAfterCheck, items.length - 1)];
      (item?.querySelector<HTMLElement>('button:not([hidden])') ?? heading).focus();
      focusAfterCheck = null;
    }
  }

  function renderWords(): void {
    // Also drawn after a change in another tab or device: focus stays on the
    // same word, or the next one (audit 3 G-1).
    keepFocus(() => {
      wordList.replaceChildren(
        ...state.words.map((word) => {
          const item = required<HTMLLIElement>(
            wordTemplate.content.cloneNode(true) as DocumentFragment,
            'li',
          );
          item.dataset['word'] = word;
          required<HTMLElement>(item, '[data-word]').textContent = word;
          required<HTMLElement>(item, '[data-action="remove-word"]').setAttribute(
            'aria-label',
            `Remove “${word}” from my dictionary`,
          );
          return item;
        }),
      );
    }, dictionaryHeading);
    noWords.hidden = state.words.length > 0;
  }

  /** Changes the dictionary; false if it couldn't be saved. */
  function setWords(words: string[]): boolean {
    const saved = save({ ...state, words });
    sync.changed();
    tell({ type: 'words', words });
    renderWords();
    check();
    roomAgain();
    return saved;
  }

  /** There's room in the dictionary again: the note that it's full goes. */
  function roomAgain(): void {
    if (fullNote === null || state.words.length >= MAX_WORDS) return;
    clearProblem(fullNote);
    fullNote = null;
  }

  /** The English choice or the dictionary changed elsewhere (another tab or device). */
  function settingsChanged(): void {
    for (const radio of radios) radio.checked = radio.value === state.english;
    tell({ type: 'english', english: state.english });
    tell({ type: 'words', words: state.words });
    renderWords();
    check();
    roomAgain();
  }

  // ---------- Deep check ----------

  const deep = mountDeepCheck(root, {
    textarea,
    replaceText: (text) => {
      fixText(text);
      actionStatus.textContent = '';
      saveText();
      check();
    },
    announce,
  });

  // ---------- Typing and settings ----------

  textarea.addEventListener('input', () => {
    if (fixing) return;
    actionStatus.textContent = '';
    window.clearTimeout(checkTimer);
    checkTimer = window.setTimeout(check, CHECK_DELAY_MS);
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveText, SAVE_DELAY_MS);
    deep.textChanged();
  });
  window.addEventListener('pagehide', saveText);
  root.addEventListener('visibilitychange', () => {
    if (root.visibilityState === 'hidden') saveText();
  });

  for (const radio of radios) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const english = radio.value as English;
      save({ ...state, english });
      sync.changed();
      tell({ type: 'english', english });
      check();
    });
  }

  // ---------- Fixing ----------

  list.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    const index = Number(button?.closest<HTMLElement>('[data-index]')?.dataset['index']);
    const issue = issues[index];
    if (!button || !issue) return;
    // Typed since the last check: positions may have moved, so check again first.
    if (textarea.value !== checkedText) {
      announce('The text changed. Checking it again.');
      check();
      return;
    }

    const action = button.dataset['action'];
    if (action === 'show') {
      textarea.focus();
      textarea.setSelectionRange(issue.start, issue.end);
      return;
    }
    if (action === 'add-word') {
      const word = wordToAdd(issue);
      if (word === undefined) return;
      const words = addWord(state.words, word);
      if (words === null) {
        // Shown at the top of the page and read out; focus stays on the button.
        fullNote = dictionaryFull(state.words.length);
        showProblem(fullNote);
        return;
      }
      focusAfterCheck = index;
      if (setWords(words)) announce(`Added “${word}” to your dictionary.`);
      return;
    }
    const fix = fixesToShow(issue)[Number(button.value)];
    if (!fix) return;
    fixText(applyFix(textarea.value, issue, fix));
    saveText();
    focusAfterCheck = index;
    announce(fixDone(issue, fix));
    check();
    deep.textChanged();
  });

  wordList.addEventListener('click', (event) => {
    const item = (event.target as Element)
      .closest('[data-action="remove-word"]')
      ?.closest<HTMLElement>('[data-word]');
    const word = item?.dataset['word'];
    if (!item || word === undefined) return;
    // Keep keyboard focus nearby: on the next word (or the one before).
    const position = state.words.indexOf(word);
    if (setWords(removeWord(state.words, word))) {
      announce(`Removed “${word}” from your dictionary.`);
    }
    const buttons = wordList.querySelectorAll<HTMLElement>('button');
    (buttons[Math.min(position, buttons.length - 1)] ?? textarea).focus();
  });

  // ---------- Copy and clear ----------

  required<HTMLButtonElement>(root, '[data-action="copy"]').addEventListener('click', () => {
    navigator.clipboard.writeText(textarea.value).then(
      () => {
        tellDone('Copied. You can paste it anywhere.');
      },
      () => {
        tellDone('Couldn’t copy. Select the text and copy it yourself.');
      },
    );
  });

  required<HTMLButtonElement>(root, '[data-action="clear"]').addEventListener('click', () => {
    clearDialog.returnValue = '';
    clearDialog.showModal();
  });

  clearDialog.addEventListener('close', () => {
    if (clearDialog.returnValue !== 'confirm') return;
    textarea.value = '';
    textLimit.clear();
    saveText();
    check();
    deep.textChanged();
    tellDone('Cleared.');
    textarea.focus();
  });

  // If Grammar is open in two tabs, keep them the same.
  window.addEventListener('storage', (event) => {
    if (event.key !== store.key) return;
    state = store.load();
    if (textarea.value !== state.text) {
      textarea.value = state.text;
      textLimit.clear();
      deep.textChanged();
    }
    settingsChanged();
  });

  // Sync between devices through the shkriuss account (if turned on).
  const sync = createSync({
    app: site.slug,
    stores: [syncedStore({ store, items: syncedSettings, withItems: withSyncedSettings })],
    onChange: () => {
      // Only settings come in: the text box keeps what's being typed.
      state = { ...store.load(), text: state.text };
      settingsChanged();
    },
  });
  mountSyncControls(required<HTMLElement>(root, '[data-sync-controls]'), sync);

  // ---------- Start ----------

  textarea.value = state.text;
  for (const radio of radios) radio.checked = radio.value === state.english;
  renderWords();
  setStatus(LOADING);
  // On a first visit, the offline copy includes the checker: let it finish
  // first, so the 8 MB are downloaded once (then they come from the copy).
  void offlineCopySaved().then(startChecker);
}
