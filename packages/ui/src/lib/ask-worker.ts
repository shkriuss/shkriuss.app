/**
 * Asking a web worker something and waiting for its answer, for work that
 * would freeze the page, like making photos smaller in Photos and Repairs.
 * On the page:
 *
 *   const makeSmaller = askWorker<File, Made>(() => startWorker(url), { kind: 'failed' });
 *   const made = await makeSmaller(file);
 *
 * and in the worker:
 *
 *   answerQuestions<File, Made>(make, { kind: 'failed' });
 *
 * Both are also in @shkriuss/ui/worker.
 */

/** What either side needs to have (a test can stand in for a worker). */
export interface MessageSide {
  postMessage(message: unknown): void;
  addEventListener(type: 'message' | 'error', listener: (event: Event) => void): void;
}

/** The worker, seen from the page. */
export interface WorkerSide extends MessageSide {
  terminate(): void;
}

interface Asked<Question> {
  id: number;
  question: Question;
}

interface Answered<Answer> {
  id: number;
  answer: Answer;
}

/**
 * Returns a function that asks the worker `start()` gives, and resolves with
 * its answer. The worker starts at the first question, so a page that never
 * asks never loads it. If it can't start or stops working, every question
 * waiting gets `failed`, and the next one starts a new worker.
 */
export function askWorker<Question, Answer>(
  start: () => WorkerSide,
  failed: Answer,
): (question: Question) => Promise<Answer> {
  let worker: WorkerSide | null = null;
  let lastId = 0;
  const waiting = new Map<number, (answer: Answer) => void>();

  function started(): WorkerSide {
    if (worker) return worker;
    const created = start();
    created.addEventListener('message', (event) => {
      const data = (event as MessageEvent<Partial<Answered<Answer>> | null>).data;
      if (typeof data?.id !== 'number') return;
      waiting.get(data.id)?.(data.answer as Answer);
      waiting.delete(data.id);
    });
    created.addEventListener('error', () => {
      // Nothing more will come back: everyone waiting carries on.
      created.terminate();
      if (worker === created) worker = null;
      for (const done of waiting.values()) done(failed);
      waiting.clear();
    });
    worker = created;
    return created;
  }

  return (question) =>
    new Promise((resolve) => {
      lastId += 1;
      const id = lastId;
      try {
        started().postMessage({ id, question } satisfies Asked<Question>);
        waiting.set(id, resolve);
      } catch {
        // It couldn't start, or the question can't be sent to it.
        resolve(failed);
      }
    });
}

/**
 * Inside a worker: answers each question askWorker() sends with `answer`,
 * or with `failed` if that throws. `self` is the worker's own side (a test
 * can stand in).
 */
export function answerQuestions<Question, Answer>(
  answer: (question: Question) => Answer | Promise<Answer>,
  failed: Answer,
  self: MessageSide = globalThis as unknown as MessageSide,
): void {
  self.addEventListener('message', (event) => {
    const { id, question } = (event as MessageEvent<Asked<Question>>).data;
    const reply = (result: Answer) => {
      self.postMessage({ id, answer: result } satisfies Answered<Answer>);
    };
    void Promise.resolve()
      .then(() => answer(question))
      .catch(() => failed)
      .then(reply)
      // An answer that can't be sent back: say it failed rather than leave the page waiting.
      .catch(() => reply(failed));
  });
}
