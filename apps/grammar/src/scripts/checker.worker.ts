/**
 * Grammar's checker, in a web worker so the page never freezes: Harper
 * (harper.js) loads its WebAssembly file from this site (about 8 MB, once;
 * the offline service worker keeps it), then checks text here, on this
 * device. Nothing is sent anywhere. Started by grammar.ts with startWorker().
 */
import { binary } from 'harper.js/binary';
import { Dialect, LocalLinter, SuggestionKind, type Lint } from 'harper.js';
import {
  plainMessage,
  type English,
  type Fix,
  type FromChecker,
  type Issue,
  type ToChecker,
} from '../lib/grammar.ts';

const dialectOf = (english: English): Dialect =>
  english === 'british' ? Dialect.British : Dialect.American;

const send = (message: FromChecker): void => {
  postMessage(message);
};

function fixKind(kind: SuggestionKind): Fix['kind'] {
  if (kind === SuggestionKind.Remove) return 'remove';
  if (kind === SuggestionKind.InsertAfter) return 'insert-after';
  return 'replace';
}

/** A plain copy of a lint (lints live in WebAssembly memory and can't be sent). */
function issueOf(lint: Lint): Issue {
  const span = lint.span();
  const suggestions = lint.suggestions();
  const issue: Issue = {
    kind: lint.lint_kind(),
    label: lint.lint_kind_pretty(),
    start: span.start,
    end: span.end,
    problem: lint.get_problem_text(),
    message: plainMessage(lint.message()),
    fixes: suggestions.map((suggestion) => ({
      kind: fixKind(suggestion.kind()),
      text: suggestion.get_replacement_text(),
    })),
  };
  for (const suggestion of suggestions) suggestion.free();
  span.free();
  lint.free();
  return issue;
}

let linter: Promise<LocalLinter> | undefined;
/** Only the newest text is worth checking. */
let newest = 0;
/** The person's dictionary, imported again whenever the linter is remade. */
let words: string[] = [];

async function handle(message: ToChecker): Promise<void> {
  if (message.type === 'start') {
    linter = (async () => {
      const local = new LocalLinter({ binary, dialect: dialectOf(message.english) });
      await local.setup();
      words = message.words;
      if (words.length > 0) await local.importWords(words);
      return local;
    })();
    await linter;
    send({ type: 'ready' });
    return;
  }
  if (!linter) return;
  if (message.type === 'check') {
    const local = await linter;
    if (message.id !== newest) return;
    const lints = await local.lint(message.text, { language: 'plaintext' });
    send({ type: 'checked', id: message.id, issues: lints.map(issueOf) });
    return;
  }
  const local = await linter;
  if (message.type === 'english') {
    // Changing the English makes a new linter, without the person's words.
    await local.setDialect(dialectOf(message.english));
    if (words.length > 0) await local.importWords(words);
  } else {
    words = message.words;
    await local.clearWords();
    if (words.length > 0) await local.importWords(words);
  }
}

/**
 * Messages are handled one at a time, in order (audit F3-4). Changing the
 * English remakes the linter: handled at the same time, a new dictionary
 * (sent with it when the choice changes on another device) was put into
 * the old one, already freed, and the checker failed.
 */
let queue: Promise<void> = Promise.resolve();

addEventListener('message', (event: MessageEvent<ToChecker>) => {
  const message = event.data;
  // Only the newest text is worth checking: an older one still waiting is skipped.
  if (message.type === 'check') newest = message.id;
  queue = queue
    .then(() => handle(message))
    .catch(() => {
      send({ type: 'failed' });
    });
});
