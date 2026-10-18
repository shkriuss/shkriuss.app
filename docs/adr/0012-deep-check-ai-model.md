# 0012. Deep check: an AI grammar model on the device, downloaded on request

Status: Accepted (2026-10-18)

## Context

Grammar's checker, Harper ([ADR 0011](0011-on-device-grammar-checking.md)),
follows rules: it's fast and private, but it misses most mistakes in real
writing. The owner wants text as close to correct as possible, still checked
on the device and offline, on a Pixel 9 Pro, Pixel Tablet and Pixel 6a with
GrapheneOS (Vanadium: no WebGPU, JavaScript JIT off unless allowed per site)
and an iPhone SE 2022 (Safari, 4 GB of memory).

We compared models on 400 sentences of real learner essays (the public
BEA-2019 W&I+LOCNESS development set, 690 teacher corrections), scored with
ERRANT. "Fixed": teacher corrections the model also made. "Matched": the
model's changes that match the teacher's.

| Model                                 | Download    | Fixed (of 690) | Matched |
| ------------------------------------- | ----------- | -------------- | ------- |
| Harper                                | 8 MB        | 37             | 27%     |
| T5 tiny / mini                        | 34 / ~60 MB | 214 / 243      | 39%     |
| CoEdIT large (non-commercial licence) | ~800 MB     | 280            | 43%     |
| Qwen3 1.7B (chat model)               | ~1.2 GB     | 205            | 46%     |
| GECToR Base                           | 130 MB      | 268            | 59%     |
| **GECToR Large, at least 70% sure**   | **361 MB**  | **256**        | **67%** |

Published results on the same set agree: GPT-4 asked to correct scores 43
(F0.5), fine-tuned 11–20 billion parameter models 56–59, GECToR Large 56
("Pillars of Grammatical Error Correction", Grammarly, 2024); ours was 57.7.

## Decision

- **Deep check uses GECToR Large** (GECToR-2024, RoBERTa-large, by
  Grammarly's researchers; the int8 ONNX conversion
  `Meyssa/gector-large-2024`, Apache-2.0, at a pinned commit and SHA-256).
  It labels each word ($KEEP, $REPLACE_have, $APPEND_the, …); a change is
  suggested only when the model is at least 70% sure, and a sentence is read
  again until nothing changes (up to 5 times). A second, separate set of 400
  sentences gave the same results for this setting.
- **The app's code reproduces what was measured.** `apps/grammar/src/lib/`:
  `sentences.ts` (text → sentences and words, like spaCy), `bpe.ts` (words →
  the model's word pieces), `gector.ts` (labels → corrected words),
  `changes.ts` (corrected words → changes to the text, keeping the person's
  spacing and apostrophes). Unit tests check the word pieces against Hugging
  Face's tokenizer (731 words) and the labels against the tested Python code
  (126 cases). Run on the raw test sentences, the whole pipeline scored
  67.4% matched, 248 fixed (F0.5 57.3), against 67.0%, 256 (57.7) measured.
- **It runs with onnxruntime-web** (WebAssembly, on the processor, no WebGPU)
  in a worker (`deep-check.worker.ts`), on up to 4 cores.
- **Downloaded only when asked.** Files in an app's `public/on-demand/` are
  never in the offline copy (the service worker's precache). Grammar
  downloads them when the person taps "Download Deep check" (381 MB), checks
  each file's SHA-256 against `manifest.json`, and saves them in its own
  cache (`deep-check`) with the site's headers. The service worker serves
  saved files from any cache, and on updates now deletes only its own old
  caches (`shkriuss-…`), so the model survives updates. File names include
  part of their checksum, so an update downloads only changed files. "Remove
  Deep check from this device" deletes the cache.
- **Hosted on the site itself.** Before each build,
  `apps/grammar/scripts/deep-check-files.ts` downloads the model from Hugging
  Face once (pinned commit; the build fails if the SHA-256 differs), splits
  it into 24 MiB parts (Cloudflare serves files up to 25 MiB; `pnpm
check:dist` now checks every file's size), and adds onnxruntime-web's files
  (from the lockfile's version) and the model's small data files
  (`apps/grammar/deep-check/`, committed). At run time every request goes to
  grammar.shkriuss.app only.
- **CI:** the build saved for deployment leaves out `on-demand/` (it would
  fill GitHub's free 500 MB of artifact storage); the deploy job makes the
  files again from the same pinned inputs, which gives identical files.
- **Threads under Trusted Types.** onnxruntime-web starts its helper threads
  with `new Worker(new URL(import.meta.url))`, a plain URL that Trusted Types
  blocks. Apps with `"webAssembly": true` may therefore also create the
  Trusted Types policy named `default`. Only `allowThreadScripts()` from
  `@shkriuss/ui/worker` creates it, inside a worker, never on a page; it
  allows exactly the given same-site worker script URLs (here, onnxruntime's
  loader) and nothing else: no other URLs, no HTML, no script strings.
- **The page:** Harper still checks as you type. Deep check runs when the
  person taps "Check my text", shows a progress bar, and lists changes with
  Accept and Skip, plus "Accept all". After that it follows edits, checking
  only changed sentences (results are remembered while the page is open).
  "Slow, or doesn't start?" explains how to allow JIT in Vanadium, and that it
  needs about 1 GB of memory.
- The model and onnxruntime-web licences ship with the app
  (`/licenses/gector.txt`, `/licenses/onnxruntime-web.txt`).

## Consequences

- About 7 times as many mistakes are found as with Harper alone. About 2 in 3
  of its changes match a teacher's exactly; reading 25 of the others, about 15
  were fine too. About 1 in 8 changes is wrong, so each is a suggestion to
  accept, never automatic. It doesn't make text "completely correct": no
  model that fits on a phone does.
- 381 MB to download once, and about 0.9 GB of memory while it's loaded
  (measured in Chromium). Fine on the Pixels. The iPhone SE (4 GB) may run
  short; if it does, a smaller model (GECToR Base, 130 MB, about a third fewer
  fixes) can be added for it.
- Speed in Chromium on our test machine: about 0.3 s per sentence with 4
  cores (20 s for 1,000 words). Phones are estimated at the same to twice as
  slow. Without JIT (Vanadium's default) it's much slower or fails to start.
- The model doesn't follow the US/UK choice; Harper does.
- Each build downloads 361 MB from Hugging Face (seconds in CI). If the file
  disappears, builds stop with a clear error until we host a copy elsewhere.
  PR previews upload the model to each preview.
- Dependabot updates onnxruntime-web like any dependency; phones with Deep
  check are offered the update and download only the changed files.

## Alternatives

- **Bigger or chat models** (Qwen3 1.7B, CoEdIT large): bigger and scored
  lower, because they reword sentences that were fine. The best published
  model (Gemma 2 27B, fine-tuned) isn't released and needs about 15 GB.
- **WebGPU**: off in Vanadium, and not needed for a model this size.
- **A native Android app**: about 3 times faster with the same model, but no
  iPhone, a second codebase in another language, and app signing and
  updates. Discussed with the owner; not now.
- **Precaching the model**: everyone opening Grammar would download 381 MB.
- **The model in git or Git LFS**: a permanently bigger repository, or LFS
  bandwidth limits on every CI run.
- **One core only** (no `default` policy): no CSP change, but half as fast.
- **transformers.js**: brings its own copy of onnxruntime-web and fetches
  from Hugging Face by default; the tokenizer we need is about 100 lines.
