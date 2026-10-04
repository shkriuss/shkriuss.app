/** One problem found by a repository check. */
export interface Violation {
  /** Path relative to the repository root, with forward slashes. */
  readonly file: string;
  /** 1-based line number, when the problem has a location. */
  readonly line?: number;
  readonly message: string;
}

/** Formats a violation as `file:line: message`, the shape editors and CI logs link up. */
export function formatViolation(violation: Violation): string {
  const location =
    violation.line === undefined ? violation.file : `${violation.file}:${violation.line}`;
  return `${location}: ${violation.message}`;
}

/** 1-based line number of a character offset in `text`. */
export function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
