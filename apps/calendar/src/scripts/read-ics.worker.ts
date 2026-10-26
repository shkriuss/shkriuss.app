/**
 * Reads a chosen .ics file (lib/ics-import.ts) in a web worker, so a big or
 * odd file never freezes the page: an ordinary 5 MB export took about 2
 * seconds, and a crafted one 17 (audit 4 C-3). Asked by import-results.ts
 * with askWorker().
 */
import { answerQuestions } from '@shkriuss/ui/worker';
import { parseIcs, UNREADABLE, type ParseResult } from '../lib/ics-import.ts';
import type { ReadFile } from './import-results.ts';

answerQuestions<ReadFile, ParseResult>(
  async ({ file, timeZone }) => parseIcs(await file.text(), { timeZone }),
  UNREADABLE,
);
