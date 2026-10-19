/**
 * Deep check on the Grammar page: downloading the model (only when asked),
 * checking the text with it (in deep-check.worker.ts, on this device), and
 * showing its changes to accept or skip. Docs: docs/adr/0012.
 *
 * Each sentence's result is remembered while the page is open, so after an
 * edit only the changed sentences are checked again.
 */
import { startWorker } from '@shkriuss/ui/worker';
import {
  applyAll,
  applyChange,
  changeDone,
  changeLabel,
  changesSummary,
  remainingAfter,
  sentenceChanges,
  type Change,
} from '../lib/changes.ts';
import {
  DEEP_CHECK_CACHE,
  DEEP_CHECK_PATH,
  downloadBytes,
  isManifest,
  manifestFiles,
  MANIFEST_URL,
  megabytes,
  type DeepCheckFile,
  type DeepCheckManifest,
  type FromDeepCheck,
  type ToDeepCheck,
} from '../lib/deep-check.ts';
import { contextOf } from '../lib/grammar.ts';
import { sentencesOf, type Sentence } from '../lib/sentences.ts';
import deepCheckUrl from './deep-check.worker.ts?worker&url';

/** Where the downloaded manifest is saved: a name the site never serves, so it's never mixed up with the current one. */
const SAVED_MANIFEST = `${DEEP_CHECK_PATH}saved-manifest.json`;
/** Checks again this long after the last key press, once Deep check has been used. */
const RECHECK_DELAY_MS = 800;
/** Headers about how a file was sent, not about the file. */
const TRANSFER_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding'];

/** What Deep check needs from the rest of the page (grammar.ts). */
export interface DeepCheckHost {
  textarea: HTMLTextAreaElement;
  /** Puts new text in the box (after accepting changes): saves it and checks it. */
  replaceText(text: string): void;
  announce(message: string): void;
}

/** A change, and what identifies it if it's skipped (its sentence, and where it is in it). */
interface Found extends Change {
  id: string;
}

type Phase = 'unsupported' | 'absent' | 'downloading' | 'ready';

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Deep check: missing element ${selector}`);
  return element;
}

const supported = (): boolean =>
  typeof caches !== 'undefined' &&
  typeof WebAssembly === 'object' &&
  typeof Worker === 'function' &&
  typeof crypto !== 'undefined' &&
  'subtle' in crypto;

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The manifest of the version on the site now (undefined when offline). */
async function currentManifest(): Promise<DeepCheckManifest | undefined> {
  if (!navigator.onLine) return undefined;
  try {
    const response = await fetch(MANIFEST_URL, { cache: 'no-store' });
    const manifest: unknown = response.ok ? await response.json() : undefined;
    return isManifest(manifest) ? manifest : undefined;
  } catch {
    return undefined;
  }
}

/** The manifest of the downloaded version, if every file is there. */
async function savedManifest(): Promise<DeepCheckManifest | undefined> {
  if (!(await caches.has(DEEP_CHECK_CACHE))) return undefined;
  const cache = await caches.open(DEEP_CHECK_CACHE);
  const response = await cache.match(SAVED_MANIFEST);
  const manifest: unknown = response ? await response.json() : undefined;
  if (!isManifest(manifest)) return undefined;
  const files = await Promise.all(manifestFiles(manifest).map((file) => cache.match(file.path)));
  return files.every(Boolean) ? manifest : undefined;
}

const keyOf = (sentence: Sentence): string =>
  sentence.words.map((word) => word.model).join('\u0001');

/** What identifies a change if it's skipped: its sentence, where it is in it, and what it does. */
const idOf = (sentence: Sentence, change: Change): string =>
  `${keyOf(sentence)}\u0002${change.start - sentence.start}\u0002${change.after}`;

/** The changes, identified again in new text (accepting one changes its sentence). */
function identified(text: string, changes: readonly Found[]): Found[] {
  const sentences = sentencesOf(text);
  return changes.map((change) => {
    const sentence = sentences.find(
      (entry) => entry.start <= change.start && change.start <= entry.end,
    );
    return sentence ? { ...change, id: idOf(sentence, change) } : change;
  });
}

export function mountDeepCheck(root: Document, host: DeepCheckHost): { textChanged(): void } {
  const section = required<HTMLElement>(root, '[data-deep]');
  const heading = required<HTMLElement>(section, 'h2');
  const panels = [...section.querySelectorAll<HTMLElement>('[data-deep-panel]')];
  const problem = required<HTMLElement>(section, '[data-deep-problem]');
  const size = required<HTMLElement>(section, '[data-deep-size]');
  const downloadButton = required<HTMLButtonElement>(section, '[data-action="deep-download"]');
  const downloadBar = required<HTMLProgressElement>(section, '[data-deep-download-bar]');
  const downloadStatus = required<HTMLElement>(section, '[data-deep-download-status]');
  const updateNotice = required<HTMLElement>(section, '[data-deep-update]');
  const runButton = required<HTMLButtonElement>(section, '[data-action="deep-run"]');
  const checkProgress = required<HTMLElement>(section, '[data-deep-check-progress]');
  const checkBar = required<HTMLProgressElement>(checkProgress, 'progress');
  const status = required<HTMLElement>(section, '[data-deep-status]');
  const acceptAll = required<HTMLButtonElement>(section, '[data-action="deep-accept-all"]');
  const list = required<HTMLUListElement>(section, '[data-deep-changes]');
  const changeTemplate = required<HTMLTemplateElement>(root, '[data-change-template]');
  const removeDialog = required<HTMLDialogElement>(root, '[data-deep-remove-dialog]');

  let phase: Phase = 'absent';
  /** The downloaded version, and the one on the site now. */
  let saved: DeepCheckManifest | undefined;
  let current: DeepCheckManifest | undefined;
  let download: AbortController | undefined;

  let worker: Worker | undefined;
  let workerReady: Promise<boolean> | undefined;
  let lastId = 0;
  /** The check the worker is doing now. */
  let pending: { id: number; keys: string[]; text: string; sentences: Sentence[] } | undefined;
  /** Corrected words for each sentence checked so far (by its words). */
  const corrections = new Map<string, string[]>();
  const skipped = new Set<string>();
  /** The changes found, and the text they were found in. */
  let results: { text: string; changes: Found[] } | undefined;
  /** Once the person has run Deep check, it follows their edits. */
  let following = false;
  let recheckTimer: number | undefined;
  let focusAfter: number | null = null;

  function show(next: Phase): void {
    phase = next;
    for (const panel of panels) panel.hidden = panel.dataset['deepPanel'] !== next;
  }

  function setProblem(text: string): void {
    problem.textContent = text;
    problem.hidden = text === '';
    if (text !== '') host.announce(text);
  }

  // ---------- Download ----------

  /** Downloads one file, checks it's exactly right, and saves it. */
  async function saveFile(
    cache: Cache,
    file: DeepCheckFile,
    signal: AbortSignal,
    received: (bytes: number) => void,
  ): Promise<void> {
    const response = await fetch(file.path, { cache: 'no-store', signal });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.byteLength;
      received(value.byteLength);
    }
    const blob = new Blob(chunks);
    if (bytes !== file.bytes || (await sha256(blob)) !== file.sha256) {
      received(-bytes);
      throw new Error(`${file.path} arrived damaged`);
    }
    // Saved with the site's headers (its security policy too), as if just downloaded.
    const headers = new Headers(response.headers);
    for (const name of TRANSFER_HEADERS) headers.delete(name);
    await cache.put(file.path, new Response(blob, { headers }));
  }

  async function startDownload(): Promise<void> {
    setProblem('');
    current = (await currentManifest()) ?? current;
    const manifest = current;
    if (!manifest) {
      setProblem('Couldn’t reach shkriuss.app. Check your internet connection and try again.');
      return;
    }
    const cache = await caches.open(DEEP_CHECK_CACHE);
    const files = manifestFiles(manifest);
    const have = await Promise.all(files.map((file) => cache.match(file.path)));
    const missing = files.filter((_, index) => !have[index]);
    const total = downloadBytes(manifest);
    const needed = missing.reduce((sum, file) => sum + file.bytes, 0);
    let done = total - needed;

    // Older browsers can't say how much space is left: then just try.
    const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
    const free = estimate?.quota === undefined ? Infinity : estimate.quota - (estimate.usage ?? 0);
    if (free < needed * 1.05) {
      setProblem(
        `Not enough space: Deep check needs ${megabytes(needed)}, and this browser can save ${megabytes(free)} more for this site. Free up some space on this device, then try again.`,
      );
      return;
    }

    const controller = new AbortController();
    download = controller;
    show('downloading');
    host.announce(`Downloading Deep check, ${megabytes(needed)}.`);
    let announced = 0;
    const progress = () => {
      downloadBar.max = total;
      downloadBar.value = done;
      downloadStatus.textContent = `${megabytes(done)} of ${megabytes(total)}`;
      // Read out every quarter, not every update.
      const quarter = Math.floor((done / total) * 4);
      if (quarter > announced && quarter < 4) {
        announced = quarter;
        host.announce(`${quarter * 25}% downloaded.`);
      }
    };
    progress();

    try {
      for (const file of missing) {
        await saveFile(cache, file, controller.signal, (bytes) => {
          done += bytes;
          progress();
        });
      }
      await cache.put(
        SAVED_MANIFEST,
        new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } }),
      );
      // Files of an older version aren't needed any more.
      const wanted = new Set([...files.map((file) => file.path), SAVED_MANIFEST]);
      for (const request of await cache.keys()) {
        if (!wanted.has(new URL(request.url).pathname)) await cache.delete(request);
      }
      // Ask the browser to keep it when space runs low (it may say no).
      await navigator.storage?.persist?.().catch(() => false);
      saved = manifest;
      stopWorker();
      updateNotice.hidden = true;
      show('ready');
      host.announce('Deep check is downloaded. It works offline now.');
      runButton.focus();
    } catch (error) {
      show(saved ? 'ready' : 'absent');
      if (controller.signal.aborted) {
        setProblem('Download stopped. Download again to continue where it stopped.');
      } else if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        setProblem('Not enough space on this device. Free up some space, then try again.');
      } else {
        setProblem(
          'The download didn’t finish. Check your internet connection and try again: it continues where it stopped.',
        );
      }
      (saved ? runButton : downloadButton).focus();
    } finally {
      download = undefined;
    }
  }

  async function remove(): Promise<void> {
    stopWorker();
    await caches.delete(DEEP_CHECK_CACHE);
    saved = undefined;
    results = undefined;
    following = false;
    corrections.clear();
    skipped.clear();
    render();
    status.textContent = '';
    size.textContent = current ? megabytes(downloadBytes(current)) : size.textContent;
    show('absent');
    host.announce('Removed Deep check from this device.');
    downloadButton.focus();
  }

  // ---------- Checking ----------

  function stopWorker(): void {
    worker?.terminate();
    worker = undefined;
    workerReady = undefined;
    pending = undefined;
  }

  function failed(reason: 'files' | 'start'): void {
    stopWorker();
    checkProgress.hidden = true;
    runButton.disabled = false;
    status.textContent = '';
    if (reason === 'files') {
      saved = undefined;
      show('absent');
      setProblem('Some Deep check files are missing from this device. Download it again.');
    } else {
      setProblem(
        'Deep check couldn’t start in this browser. Updating the browser may help. See also “Slow, or doesn’t start?” below.',
      );
    }
  }

  function heard(message: FromDeepCheck): void {
    if (message.type === 'ready' || message.type === 'failed') return;
    if (!pending || message.id !== pending.id) return;
    if (message.type === 'progress') {
      checkBar.value = message.done;
      status.textContent = `Checked ${message.done} of ${message.total} sentences…`;
      return;
    }
    message.corrected.forEach((words, index) => {
      const key = pending?.keys[index];
      if (key !== undefined) corrections.set(key, words);
    });
    const { text, sentences } = pending;
    pending = undefined;
    // Typed while it was checking: check the new text (mostly remembered already).
    if (host.textarea.value !== text) void check();
    else finish(text, sentences);
  }

  function startWorkerOnce(manifest: DeepCheckManifest): Promise<boolean> {
    workerReady ??= new Promise<boolean>((resolve) => {
      status.textContent = 'Starting Deep check. This takes a few seconds…';
      const started = startWorker(deepCheckUrl);
      worker = started;
      started.addEventListener('message', (event: MessageEvent<FromDeepCheck>) => {
        const message = event.data;
        if (message.type === 'ready') resolve(true);
        if (message.type === 'failed') {
          resolve(false);
          failed(message.reason);
        }
        heard(message);
      });
      started.addEventListener('error', () => {
        resolve(false);
        failed('start');
      });
      const start: ToDeepCheck = { type: 'start', manifest };
      started.postMessage(start);
    });
    return workerReady;
  }

  async function check(): Promise<void> {
    window.clearTimeout(recheckTimer);
    const manifest = saved;
    if (phase !== 'ready' || !manifest) return;
    following = true;
    setProblem('');
    const text = host.textarea.value;
    const sentences = sentencesOf(text);
    const missing = [...new Set(sentences.map(keyOf).filter((key) => !corrections.has(key)))];
    if (missing.length === 0) {
      finish(text, sentences);
      return;
    }
    runButton.disabled = true;
    if (!(await startWorkerOnce(manifest))) return;
    lastId += 1;
    pending = { id: lastId, keys: missing, text, sentences };
    checkProgress.hidden = false;
    checkBar.max = missing.length;
    checkBar.value = 0;
    status.textContent =
      missing.length === 1 ? 'Checking a sentence…' : `Checking ${missing.length} sentences…`;
    const message: ToDeepCheck = {
      type: 'check',
      id: lastId,
      sentences: missing.map((key) => key.split('\u0001')),
    };
    worker?.postMessage(message);
  }

  function finish(text: string, sentences: Sentence[]): void {
    runButton.disabled = false;
    checkProgress.hidden = true;
    // A corrected sentence is already right: accepting its changes needs no new check.
    for (const words of [...corrections.values()]) {
      const key = words.join('\u0001');
      if (!corrections.has(key)) corrections.set(key, words);
    }
    const changes = sentences.flatMap((sentence) =>
      sentenceChanges(text, sentence, corrections.get(keyOf(sentence)) ?? [])
        .map((change) => ({ ...change, id: idOf(sentence, change) }))
        .filter((change) => !skipped.has(change.id)),
    );
    results = { text, changes };
    render();
    host.announce(`Deep check: ${changesSummary(changes.length)}`);
  }

  // ---------- Showing and accepting changes ----------

  function renderChange(change: Found, index: number): HTMLLIElement {
    const item = required<HTMLLIElement>(
      changeTemplate.content.cloneNode(true) as DocumentFragment,
      'li',
    );
    item.dataset['index'] = String(index);
    const context = contextOf(results?.text ?? '', change);
    required<HTMLElement>(item, '[data-before]').textContent = context.before;
    required<HTMLElement>(item, '[data-removed]').textContent = change.before;
    required<HTMLElement>(item, '[data-added]').textContent = change.after;
    required<HTMLElement>(item, '[data-after]').textContent = context.after;
    const label = changeLabel(change);
    required<HTMLElement>(item, '[data-action="accept"]').textContent = label;
    required<HTMLElement>(item, '[data-action="skip"]').setAttribute(
      'aria-label',
      `Skip: ${label}`,
    );
    return item;
  }

  function render(): void {
    const changes = results?.changes ?? [];
    list.replaceChildren(...changes.map(renderChange));
    acceptAll.hidden = changes.length < 2;
    acceptAll.textContent = `Accept all ${changes.length} changes`;
    if (!pending) status.textContent = results ? changesSummary(changes.length) : '';
    if (focusAfter !== null) {
      const items = list.querySelectorAll<HTMLElement>('li');
      const item = items[Math.min(focusAfter, items.length - 1)];
      (item?.querySelector<HTMLElement>('[data-action="accept"]') ?? heading).focus();
      focusAfter = null;
    }
  }

  /** The changes are for older text: check again instead. */
  function outdated(): boolean {
    if (!results || host.textarea.value === results.text) return false;
    host.announce('The text changed. Checking it again.');
    void check();
    return true;
  }

  list.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]');
    const index = Number(button?.closest<HTMLElement>('[data-index]')?.dataset['index']);
    const change = results?.changes[index];
    if (!button || !change || !results || outdated()) return;
    if (button.dataset['action'] === 'skip') {
      skipped.add(change.id);
      results = { ...results, changes: results.changes.filter((entry) => entry !== change) };
      host.announce('Skipped.');
    } else {
      const text = applyChange(results.text, change);
      results = { text, changes: identified(text, remainingAfter(results.changes, change)) };
      host.replaceText(text);
      host.announce(changeDone(change));
    }
    focusAfter = index;
    render();
  });

  acceptAll.addEventListener('click', () => {
    if (!results || outdated()) return;
    const count = results.changes.length;
    const text = applyAll(results.text, results.changes);
    results = { text, changes: [] };
    host.replaceText(text);
    render();
    host.announce(`Made all ${count} changes.`);
    heading.focus();
  });

  // ---------- Buttons ----------

  downloadButton.addEventListener('click', () => void startDownload());
  required<HTMLButtonElement>(section, '[data-action="deep-update"]').addEventListener(
    'click',
    () => void startDownload(),
  );
  required<HTMLButtonElement>(section, '[data-action="deep-stop"]').addEventListener(
    'click',
    () => {
      download?.abort();
    },
  );
  runButton.addEventListener('click', () => void check());
  required<HTMLButtonElement>(section, '[data-action="deep-remove"]').addEventListener(
    'click',
    () => {
      removeDialog.returnValue = '';
      removeDialog.showModal();
    },
  );
  removeDialog.addEventListener('close', () => {
    if (removeDialog.returnValue === 'confirm') void remove();
  });

  // ---------- Start ----------

  if (!supported()) {
    show('unsupported');
  } else {
    void (async () => {
      saved = await savedManifest().catch(() => undefined);
      show(saved ? 'ready' : 'absent');
      current = await currentManifest();
      const shown = current ?? saved;
      if (shown) size.textContent = megabytes(downloadBytes(shown));
      // A newer version is on the site: offer it (only the changed files download).
      const savedPaths = new Set(saved ? manifestFiles(saved).map((file) => file.path) : []);
      updateNotice.hidden = !(
        saved &&
        current &&
        manifestFiles(current).some((file) => !savedPaths.has(file.path))
      );
    })();
  }

  return {
    textChanged(): void {
      if (!following || phase !== 'ready') return;
      window.clearTimeout(recheckTimer);
      recheckTimer = window.setTimeout(() => void check(), RECHECK_DELAY_MS);
    },
  };
}
