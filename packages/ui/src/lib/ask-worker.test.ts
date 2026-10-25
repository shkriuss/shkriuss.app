import { describe, expect, it, vi } from 'vitest';
import { answerQuestions, askWorker, type MessageSide } from './ask-worker.ts';

/** A worker running `answer`, joined to the page like a real one: messages arrive later, copied. */
function fakeWorker(answer: (question: number) => number | Promise<number>) {
  const page = new EventTarget();
  const inside = new EventTarget();
  const send = (to: EventTarget, message: unknown) =>
    setTimeout(() =>
      to.dispatchEvent(new MessageEvent('message', { data: structuredClone(message) })),
    );
  const self: MessageSide = {
    postMessage: (message) => send(page, message),
    addEventListener: (type, listener) => inside.addEventListener(type, listener),
  };
  answerQuestions(answer, -1, self);
  return {
    postMessage: (message: unknown) => send(inside, message),
    addEventListener: (type: 'message' | 'error', listener: (event: Event) => void) =>
      page.addEventListener(type, listener),
    terminate: vi.fn(),
    /** Like a worker whose script couldn't load. */
    fail: () => page.dispatchEvent(new Event('error')),
  };
}

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('asking a worker', () => {
  it('gives each question its own answer, whatever order they come back in', async () => {
    const start = vi.fn(() =>
      fakeWorker(async (question) => {
        await later(30 - question * 10);
        return question * 2;
      }),
    );
    const ask = askWorker<number, number>(start, -1);
    expect(start).not.toHaveBeenCalled();
    expect(await Promise.all([ask(1), ask(2), ask(3)])).toEqual([2, 4, 6]);
    // Started at the first question, once.
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('answers failed when the work throws, and carries on', async () => {
    const ask = askWorker<number, number>(
      () =>
        fakeWorker((question) => {
          if (question === 2) throw new Error('Not a photo.');
          return question * 2;
        }),
      -1,
    );
    expect(await Promise.all([ask(1), ask(2), ask(3)])).toEqual([2, -1, 6]);
  });

  it('answers failed to everyone waiting when the worker stops, and starts a new one', async () => {
    const workers: ReturnType<typeof fakeWorker>[] = [];
    const ask = askWorker<number, number>(() => {
      // The first never answers.
      const worker = fakeWorker((question) =>
        workers.length === 1 ? new Promise<number>(() => undefined) : question * 2,
      );
      workers.push(worker);
      return worker;
    }, -1);
    const waiting = Promise.all([ask(1), ask(2)]);
    await later(10);
    workers[0]?.fail();
    expect(await waiting).toEqual([-1, -1]);
    expect(workers[0]?.terminate).toHaveBeenCalled();
    expect(await ask(3)).toBe(6);
    expect(workers).toHaveLength(2);
  });

  it('answers failed when the worker can’t start, and tries again next time', async () => {
    let tries = 0;
    const ask = askWorker<number, number>(() => {
      tries += 1;
      if (tries === 1) throw new TypeError('Blocked worker URL');
      return fakeWorker((question) => question * 2);
    }, -1);
    expect(await ask(1)).toBe(-1);
    expect(await ask(2)).toBe(4);
  });
});
