/**
 * The privacy page's "Last updated" date is the day its text went live
 * (audit 6 D-2). `LAST_UPDATED` in the page is the day the text was
 * written, which ../privacy.test.ts keeps with the text. But a pull request
 * can wait days before it's merged, and merging is what puts it live: the
 * fifth audit's text, written on 27 October, went live on 31 October, and
 * the page said 27 October.
 *
 * Pull requests are squash-merged, so each is one commit on main, made when
 * it was merged. So the build looks for the newest commit on its branch's
 * own line (first parents) that changed the date line, and shows that
 * commit's day when it's later. When git can't tell (no git, or not enough
 * history fetched), the page shows `LAST_UPDATED`, as before.
 */
import { execFileSync } from 'node:child_process';

/** The page, from the top of the repository. */
export const PRIVACY_PAGE = 'apps/hub/src/pages/privacy.astro';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * "2026-10-31T19:46:57+04:00" → "31 October 2026": the day where the commit
 * was made (the person merging it), not in UTC. Null if it isn't such a time.
 */
export function dayOf(time: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(time);
  const month = MONTHS[Number(match?.[2]) - 1];
  return match && month ? `${Number(match[3])} ${month} ${match[1]}` : null;
}

/** "31 October 2026" → 20261031, to compare days. Null if it isn't such a day. */
function dayNumber(day: string): number | null {
  const match = /^(\d{1,2}) ([A-Z][a-z]+) (\d{4})$/.exec(day);
  const month = MONTHS.findIndex((name) => name === match?.[2]);
  return match && month >= 0
    ? Number(match[3]) * 10_000 + (month + 1) * 100 + Number(match[1])
    : null;
}

/** The day the text was written, or the day it was merged if that's later. */
export function laterDay(written: string, merged: string | null): string {
  const was = dayNumber(written);
  const went = merged === null ? null : dayNumber(merged);
  return merged !== null && was !== null && went !== null && went > was ? merged : written;
}

/** What git says, or null if it fails (no git, not a repository, nothing found). */
function git(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * The day of the newest commit, on this branch's own line, that changed the
 * page's `LAST_UPDATED` line (so its text, which the test changes it with).
 * Null when git can't tell: no git, or a shallow clone whose oldest commit
 * is the one found, which looks as if it wrote every line.
 */
export function mergedDay(cwd: string = process.cwd(), file: string = PRIVACY_PAGE): string | null {
  const found = git(cwd, [
    'log',
    '--first-parent',
    '-1',
    '-G^const LAST_UPDATED = ',
    '--format=%H %cI',
    '--',
    `:(top)${file}`,
  ]);
  const [commit, time] = found?.split(' ') ?? [];
  if (!commit || !time) return null;
  // Its parent must be here too, or it may only be the oldest commit fetched.
  if (git(cwd, ['rev-parse', '--verify', '--quiet', `${commit}^`]) === null) return null;
  return dayOf(time);
}

/** The day to show: the later of the day the text was written and the day it went live. */
export const lastUpdated = (written: string, cwd?: string): string =>
  laterDay(written, mergedDay(cwd));
