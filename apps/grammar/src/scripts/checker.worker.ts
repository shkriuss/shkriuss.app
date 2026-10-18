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

async function handle(message: ToChecker): Promise<void> {
  if (message.type === 'start') {
    linter = (async () => {
      const local = new LocalLinter({ binary, dialect: dialectOf(message.english) });
      await local.setup();
      if (message.words.length > 0) await local.importWords(message.words);
      return local;
    })();
    await linter;
    send({ type: 'ready' });
    return;
  }
  if (!linter) return;
  if (message.type === 'check') {
    newest = message.id;
    const local = await linter;
    if (message.id !== newest) return;
    const lints = await local.lint(message.text, { language: 'plaintext' });
    send({ type: 'checked', id: message.id, issues: lints.map(issueOf) });
    return;
  }
  const local = await linter;
  if (message.type === 'english') {
    await local.setDialect(dialectOf(message.english));
  } else {
    await local.clearWords();
    if (message.words.length > 0) await local.importWords(message.words);
  }
}

addEventListener('message', (event: MessageEvent<ToChecker>) => {
  handle(event.data).catch(() => {
    send({ type: 'failed' });
  });
});
