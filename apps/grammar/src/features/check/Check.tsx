import { deviceLocale } from "@shkriuss/i18n";
import { Button, Select, TextArea } from "@shkriuss/ui";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { m } from "../../messages.ts";
import type { Checker } from "./checker.ts";
import { type Fix, type Mistake, VARIETIES, type Variety } from "./protocol.ts";
import { applyFix, excerptOf, ignoreKey, plainMessage } from "./text.ts";
import { varietyOf } from "./variety.ts";

/** The longest text that the field takes. */
export const TEXT_LIMIT = 20_000;

/** How long the checker waits after the user stops typing, in milliseconds. */
const PAUSE = 500;

/** The mistakes that the checker found in a text, in a variety. */
interface Result {
  readonly text: string;
  readonly variety: Variety;
  readonly mistakes: readonly Mistake[];
}

function fixLabel(fix: Fix): string {
  if (fix.kind === "remove") {
    return m.remove();
  }
  return fix.kind === "replace" ? m.replace(fix.text) : m.insert(fix.text);
}

interface MistakeItemProps {
  readonly text: string;
  readonly mistake: Mistake;
  /** Whether the text has changed since it was checked, which leaves the fixes for later. */
  readonly stale: boolean;
  readonly headingRef: (element: HTMLHeadingElement | null) => void;
  readonly onFix: (fix: Fix) => void;
  readonly onShow: () => void;
  readonly onIgnore: () => void;
}

/** A mistake: its kind, what is wrong, its words in the text, and its fixes. */
function MistakeItem({
  text,
  mistake,
  stale,
  headingRef,
  onFix,
  onShow,
  onIgnore,
}: MistakeItemProps) {
  const excerpt = excerptOf(text, mistake);
  return (
    <li className="flex flex-col items-start gap-2 rounded-lg border border-line p-4">
      <h3 ref={headingRef} tabIndex={-1} className="font-semibold">
        {m.kind(mistake.kind)}
      </h3>
      <p>{plainMessage(mistake.message)}</p>
      <q className="break-words text-ink-muted">
        {excerpt.before}
        <mark className="rounded bg-accent px-0.5 whitespace-pre-wrap text-accent-ink">
          {excerpt.words}
        </mark>
        {excerpt.after}
      </q>
      <div className="flex flex-wrap gap-2">
        {mistake.fixes.map((fix) => (
          <Button
            key={JSON.stringify(fix)}
            variant="primary"
            isDisabled={stale}
            onPress={() => {
              onFix(fix);
            }}
          >
            {fixLabel(fix)}
          </Button>
        ))}
        <Button isDisabled={stale} onPress={onShow}>
          {m.show()}
        </Button>
        <Button onPress={onIgnore}>{m.ignore()}</Button>
      </div>
    </li>
  );
}

/**
 * The check screen's content (docs/specs/apps/grammar.md §1): the text, its variety of English,
 * Copy and Delete, then the mistakes that the checker finds in it, each with its fixes. The text
 * is checked once the checker is ready, half a second after the user stops typing, and at once
 * after a fix, another variety, Delete or Undo. Nothing is kept: the text is gone when the app
 * closes.
 */
export function Check({ checker }: { readonly checker: Checker }) {
  const state = useSyncExternalStore(checker.subscribe, checker.getState);
  const [text, setText] = useState("");
  const [variety, setVariety] = useState(() => varietyOf(deviceLocale()));
  const [result, setResult] = useState<Result>();
  const [failed, setFailed] = useState(false);
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(() => new Set());
  // What Copy, Delete or Undo did, until the text changes.
  const [notice, setNotice] = useState("");
  // The text that Delete took, which Undo brings back until the user types again: the app keeps
  // no copy of it.
  const [deleted, setDeleted] = useState<string>();
  const field = useRef<HTMLTextAreaElement>(null);
  const headings = useRef<(HTMLHeadingElement | null)[]>([]);
  // The next check comes at once, rather than after the pause.
  const now = useRef(true);
  // Where the mistake was that the user fixed or ignored, whose place the next one takes.
  const focusAt = useRef<number>(undefined);
  const headingId = useId();

  const current = result !== undefined && result.text === text && result.variety === variety;
  const shown =
    result === undefined
      ? []
      : result.mistakes.filter((mistake) => !ignored.has(ignoreKey(result.text, mistake)));

  useEffect(() => {
    // Set when the text or the variety changes again, whose answer then comes in its place.
    let cancelled = false;
    async function run(): Promise<void> {
      try {
        const mistakes = await checker.check(text, variety);
        if (!cancelled) {
          setResult({ text, variety, mistakes });
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (state === "ready" && !current) {
      timer = setTimeout(
        () => {
          void run();
        },
        now.current ? 0 : PAUSE,
      );
      now.current = false;
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [checker, state, current, text, variety]);

  // The focus was on a button of the mistake that went: it goes to the next mistake, or the one
  // before when it was the last, or the field once none is left (WCAG 2.4.3).
  useEffect(() => {
    const index = focusAt.current;
    if (index === undefined || !current) {
      return;
    }
    focusAt.current = undefined;
    const heading = shown.length === 0 ? null : headings.current[Math.min(index, shown.length - 1)];
    (heading ?? field.current)?.focus();
  });

  function edit(next: string): void {
    setText(next);
    setNotice("");
    setDeleted(undefined);
  }

  function fix(index: number, mistake: Mistake, chosen: Fix): void {
    if (!current) {
      return;
    }
    now.current = true;
    focusAt.current = index;
    edit(applyFix(text, mistake, chosen));
  }

  function show(mistake: Mistake): void {
    const element = field.current;
    if (element !== null) {
      element.focus();
      element.setSelectionRange(mistake.start, mistake.end);
    }
  }

  function ignore(index: number, mistake: Mistake): void {
    if (result === undefined) {
      return;
    }
    focusAt.current = index;
    setIgnored((keys) => new Set(keys).add(ignoreKey(result.text, mistake)));
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(m.copied());
    } catch {
      setNotice(m.copyFailed());
    }
  }

  function deleteText(): void {
    now.current = true;
    edit("");
    setDeleted(text);
    setNotice(m.deleted());
  }

  function undo(): void {
    if (deleted === undefined) {
      return;
    }
    now.current = true;
    edit(deleted);
    setNotice(m.undone());
  }

  let status = "";
  if (state === "failed") {
    status = m.cannotStart();
  } else if (failed) {
    status = m.checkFailed();
  } else if (result === undefined && text !== "") {
    // The checker's start, which takes seconds each time the app opens, and its first check
    // are worth a word only once there is text to check.
    status = state === "starting" ? m.gettingReady() : m.checking();
  } else if (result !== undefined && result.text !== "") {
    status = m.found(shown.length);
  }

  return (
    <div className="flex flex-col gap-4">
      <TextArea
        label={m.text()}
        description={m.textHelp(TEXT_LIMIT)}
        value={text}
        onChange={edit}
        maxLength={TEXT_LIMIT}
        rows={8}
        // Some browsers send the text to a server to check its spelling.
        spellCheck="false"
        textAreaRef={field}
      />
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label={m.english()}
          options={VARIETIES.map((value) => ({ value, label: m[value]() }))}
          value={variety}
          onChange={(next) => {
            now.current = true;
            setVariety(next);
          }}
        />
        <Button
          isDisabled={text === ""}
          onPress={() => {
            void copy();
          }}
        >
          {m.copy()}
        </Button>
        {/* Undo takes Delete's place, so that the focus stays on it. */}
        <Button
          isDisabled={text === "" && deleted === undefined}
          onPress={deleted === undefined ? deleteText : undo}
        >
          {deleted === undefined ? m.delete() : m.undo()}
        </Button>
      </div>
      {/* <output>s, whose role is status: screen readers read what changes. */}
      <output className="block">{notice}</output>
      <output className="block font-medium">{status}</output>
      {shown.length === 0 || state !== "ready" || failed ? null : (
        <section aria-labelledby={headingId} className="flex flex-col gap-3">
          <h2 id={headingId} className="text-lg font-semibold">
            {m.mistakes()}
          </h2>
          <ul className="flex flex-col gap-3">
            {shown.map((mistake, index) => (
              <MistakeItem
                key={`${String(mistake.start)}-${String(mistake.end)}-${mistake.kind}`}
                text={result?.text ?? text}
                mistake={mistake}
                stale={!current}
                headingRef={(element) => {
                  headings.current[index] = element;
                }}
                onFix={(chosen) => {
                  fix(index, mistake, chosen);
                }}
                onShow={() => {
                  show(mistake);
                }}
                onIgnore={() => {
                  ignore(index, mistake);
                }}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
