import { TextField } from "@shkriuss/ui";
import { useState } from "react";
import { m } from "../../messages.ts";

const words = new Intl.Segmenter("en", { granularity: "word" });

/** How many words `text` has: its segments with letters or digits, as Unicode splits words. */
function countWords(text: string): number {
  let count = 0;
  for (const segment of words.segment(text)) {
    if (segment.isWordLike === true) {
      count += 1;
    }
  }
  return count;
}

/**
 * The example feature, which a new app replaces with its own: a text, whose words it counts as
 * the user types. It keeps nothing: the text is only in the page, until the app closes.
 */
export function Words() {
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <TextField label={m.text()} value={text} onChange={setText} />
      {/* An <output>, whose role is status: screen readers read the count as it changes. */}
      <output className="block">{m.words(countWords(text))}</output>
    </div>
  );
}
