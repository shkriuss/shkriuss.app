/**
 * How deep data from outside (a backup, another device's copy) may nest
 * arrays and objects. The apps' own data nests a dozen levels at most; past
 * a few thousand, the code that compares items (canonical() in
 * @shkriuss/sync) runs out of stack, so a crafted file far under 1 KB could
 * stop sync for good (audit 3 C-1).
 */
export const MAX_NESTING = 64;

/** Whether `value` (as parsed from JSON) nests arrays and objects more than `max` levels deep. */
export function nestedTooDeep(value: unknown, max = MAX_NESTING): boolean {
  // A list rather than recursion, so the check itself can't run out of stack.
  const waiting: [unknown, number][] = [[value, 1]];
  for (let next = waiting.pop(); next; next = waiting.pop()) {
    const [item, depth] = next;
    if (item === null || typeof item !== 'object') continue;
    if (depth > max) return true;
    for (const child of Array.isArray(item) ? item : Object.values(item)) {
      waiting.push([child, depth + 1]);
    }
  }
  return false;
}
