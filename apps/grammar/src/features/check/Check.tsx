import { Button, Select, TextArea } from "@shkriuss/ui";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { m } from "../../messages.ts";
import type { Checker } from "./checker.ts";
import { type DraftStore, isChecked } from "./draft.ts";
import { type Fix, type Mistake, VARIETIES } from "./protocol.ts";
import { applyFix, excerptOf, ignoreKey, plainMessage } from "./text.ts";

/** The longest text that the field takes. */
export const TEXT_LIMIT = 20_000;

/** How long the checker waits after the user stops typing, in milliseconds. */
const PAUSE = 500;

/**
 * How many mistakes the list shows at first, and how many more each Show more adds: a long text
 * can have more than a thousand, which would take seconds to show each time they change.
 */
const LIST_STEP = 50;

function fixLabel(fix: Fix): string {
  if (fix.kind === "remove") {
    return m.remove();
  }
  return fix.kind === "replace" ? m.replace(fix.text) : m.insert(fix.text);
}

interface MistakeItemProps {
  /** The text that was checked, in which the mistake is. */
  readonly text: string;
  readonly mistake: Mistake;
  /** Its place in the list. */
  readonly index: number;
  /** Whether the text has changed since it was checked, which leaves the fixes for later. */
  readonly stale: boolean;
  readonly onHeading: (index: number, heading: HTMLHeadingElement | null) => void;
  readonly onFix: (index: number, mistake: Mistake, fix: Fix) => void;
  readonly onShow: (mistake: Mistake) => void;
  readonly onIgnore: (index: number, mistake: Mistake) => void;
}

/**
 * A mistake: its kind, what is wrong, its words in the text, and its fixes. What it gets stays
 * the same while the user types, so it renders again only once the mistakes change, or once the
 * text first does after they were found.
 */
const MistakeItem = memo(function MistakeItem({
  text,
  mistake,
  index,
  stale,
  onHeading,
  onFix,
  onShow,
  onIgnore,
}: MistakeItemProps) {
  const excerpt = excerptOf(text, mistake);
  return (
    <li className="flex flex-col items-start gap-2 rounded-lg border border-line p-4">
      <h3
        ref={(heading) => {
          onHeading(index, heading);
        }}
        tabIndex={-1}
        className="font-semibold"
      >
        {m.kind(mistake.kind)}
      </h3>
      <p>{plainMessage(mistake.message)}</p>
      <q className="wrap-anywhere text-ink-muted">
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
              onFix(index, mistake, fix);
            }}
          >
            {fixLabel(fix)}
          </Button>
        ))}
        {/* Named by the words, as a long list has many of each (WCAG 2.4.6). */}
        <Button
          isDisabled={stale}
          aria-label={m.showWords(excerpt.words)}
          onPress={() => {
            onShow(mistake);
          }}
        >
          {m.show()}
        </Button>
        <Button
          aria-label={m.ignoreWords(excerpt.words)}
          onPress={() => {
            onIgnore(index, mistake);
          }}
        >
          {m.ignore()}
        </Button>
      </div>
    </li>
  );
});

/** The status while there is text and no answer yet, by where the checker stands. */
const STARTING_STATUS: Readonly<Record<"starting" | "downloading" | "ready", () => string>> = {
  starting: m.gettingReady,
  downloading: m.downloading,
  ready: m.checking,
};

/**
 * The check screen's content (docs/specs/apps/grammar.md §1): the text, its variety of English,
 * Copy and Delete, then the mistakes that the checker finds in it, each with its fixes. The text
 * is checked once the checker is ready, half a second after the user stops typing, and at once
 * after a fix, another variety, Delete or Undo. The text and what goes with it are the page's
 * `draft`, which stays when the user goes to another screen, and goes when the app closes.
 */
export function Check({
  checker,
  draft,
}: {
  readonly checker: Checker;
  readonly draft: DraftStore;
}) {
  const state = useSyncExternalStore(checker.subscribe, checker.getState);
  const snapshot = useSyncExternalStore(draft.subscribe, draft.getState);
  const { text, variety, ignored, deleted, result } = snapshot;
  const [failed, setFailed] = useState(false);
  // What Copy, Delete or Undo did, until the text changes.
  const [notice, setNotice] = useState("");
  // How many of the mistakes the list shows.
  const [limit, setLimit] = useState(LIST_STEP);
  const field = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLElement>(null);
  const headings = useRef<(HTMLHeadingElement | null)[]>([]);
  // The next check comes at once, rather than after the pause.
  const now = useRef(true);
  // Where the mistake was that the user fixed or ignored, whose place the next one takes once
  // the text is checked.
  const focusAt = useRef<number>(undefined);
  const headingId = useId();

  const current = isChecked(snapshot);
  const shown = useMemo(
    () =>
      result === undefined
        ? []
        : result.mistakes.filter((mistake) => !ignored.has(ignoreKey(result.text, mistake))),
    [result, ignored],
  );
  // The first keystroke after a check makes every mistake's fixes wait: the list shows that
  // after the keystroke, rather than hold it up. A new check's fixes are ready at once.
  const changed = useDeferredValue(!current);
  const stale = !current && changed;

  useEffect(() => {
    // The checker starts once there is text to check (ADR 0019), unless it has started already.
    if (text !== "") {
      checker.prepare();
    }
  }, [checker, text]);

  useEffect(() => {
    // The answer counts while the text and the variety are still those it is about, even once
    // the user has gone to another screen: the draft keeps it for when they come back.
    function stillAbout(): boolean {
      const latest = draft.getState();
      return latest.text === text && latest.variety === variety;
    }
    async function run(): Promise<void> {
      try {
        const mistakes = await checker.check(text, variety);
        if (stillAbout()) {
          draft.update({ result: { text, variety, mistakes } });
          setFailed(false);
        }
      } catch {
        if (stillAbout()) {
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
      clearTimeout(timer);
    };
  }, [checker, draft, state, current, text, variety]);

  // The focus was on a button of the mistake that went: it goes to the next mistake, or the one
  // before when it was the last, or the field once none is left (WCAG 2.4.3). If the user has put
  // it elsewhere meanwhile, such as back in the field to type, it stays there.
  useEffect(() => {
    const index = focusAt.current;
    if (index === undefined || !current) {
      return;
    }
    focusAt.current = undefined;
    const { activeElement } = document;
    if (
      activeElement !== null &&
      activeElement !== document.body &&
      list.current?.contains(activeElement) !== true
    ) {
      return;
    }
    const last = Math.min(shown.length, limit) - 1;
    const heading = last < 0 ? null : headings.current[Math.min(index, last)];
    (heading ?? field.current)?.focus();
  });

  // What the mistakes do reads the draft when the user acts, so that it stays the same from one
  // keystroke to the next, and the mistakes need not render again.
  const edit = useCallback(
    (next: string) => {
      draft.update({ text: next, deleted: undefined });
      setNotice("");
    },
    [draft],
  );

  const fix = useCallback(
    (index: number, mistake: Mistake, chosen: Fix) => {
      const latest = draft.getState();
      if (!isChecked(latest)) {
        return;
      }
      now.current = true;
      focusAt.current = index;
      edit(applyFix(latest.text, mistake, chosen));
    },
    [draft, edit],
  );

  const show = useCallback(
    (mistake: Mistake) => {
      const element = field.current;
      if (element !== null && isChecked(draft.getState())) {
        element.focus();
        element.setSelectionRange(mistake.start, mistake.end);
      }
    },
    [draft],
  );

  const ignore = useCallback(
    (index: number, mistake: Mistake) => {
      const latest = draft.getState();
      if (latest.result === undefined) {
        return;
      }
      focusAt.current = index;
      draft.update({
        ignored: new Set(latest.ignored).add(ignoreKey(latest.result.text, mistake)),
      });
    },
    [draft],
  );

  const keepHeading = useCallback((index: number, heading: HTMLHeadingElement | null) => {
    headings.current[index] = heading;
  }, []);

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
    draft.update({ text: "", deleted: text });
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

  function showMore(): void {
    const first = limit;
    // The button may go, with the focus: it goes to the first of the mistakes that come.
    flushSync(() => {
      setLimit(first + LIST_STEP);
    });
    headings.current[first]?.focus();
  }

  let status = "";
  if (state === "failed") {
    status = m.cannotStart();
  } else if (state === "offline") {
    status = m.cannotDownload();
  } else if (failed) {
    status = m.checkFailed();
  } else if (result === undefined && text !== "") {
    // The checker's start, which takes seconds each time, and its first check are worth a word
    // only once there is text to check.
    status = STARTING_STATUS[state]();
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
            draft.update({ variety: next });
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
        <section ref={list} aria-labelledby={headingId} className="flex flex-col gap-3">
          <h2 id={headingId} className="text-lg font-semibold">
            {m.mistakes()}
          </h2>
          <ul className="flex flex-col gap-3">
            {shown.slice(0, limit).map((mistake, index) => (
              <MistakeItem
                key={`${String(mistake.start)}-${String(mistake.end)}-${mistake.kind}`}
                text={result?.text ?? text}
                mistake={mistake}
                index={index}
                stale={stale}
                onHeading={keepHeading}
                onFix={fix}
                onShow={show}
                onIgnore={ignore}
              />
            ))}
          </ul>
          {shown.length > limit ? (
            <div>
              <Button onPress={showMore}>
                {m.showMore(Math.min(LIST_STEP, shown.length - limit))}
              </Button>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
