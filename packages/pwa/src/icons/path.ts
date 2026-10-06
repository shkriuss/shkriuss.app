/**
 * SVG path data (SVG 2, §9.3), as icons give their shapes: parsed into subpaths of lines and
 * cubic Bézier curves, with absolute coordinates. Quadratic curves become the cubic curves that
 * they are, and arcs the cubic curves that approximate them within a hundred-thousandth of their
 * radius.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A line to `to`, or a cubic Bézier curve to `to` with the control points `c1` and `c2`. */
export type Piece =
  | { readonly kind: "line"; readonly to: Point }
  | { readonly kind: "cubic"; readonly c1: Point; readonly c2: Point; readonly to: Point };

/** One subpath: where it starts, and its pieces. A fill closes every subpath. */
export interface Subpath {
  readonly start: Point;
  readonly pieces: readonly Piece[];
}

/** Path data that does not follow the grammar, with where the parser stopped. */
export class PathError extends Error {
  /** Where the parser stopped, from 0. */
  readonly position: number;

  constructor(message: string, position: number) {
    super(`${message}, at character ${position + 1} of the path data.`);
    this.name = "PathError";
    this.position = position;
  }
}

const NUMBER = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f"]);

/** How many numbers each command takes, per repetition. */
const ARGUMENTS: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

/** Reads numbers and flags from path data, from a position on. */
class Scanner {
  readonly data: string;
  position = 0;

  constructor(data: string) {
    this.data = data;
  }

  get done(): boolean {
    return this.position >= this.data.length;
  }

  get next(): string {
    return this.data.charAt(this.position);
  }

  skipWhitespace(): void {
    while (WHITESPACE.has(this.next)) {
      this.position += 1;
    }
  }

  /**
   * Skips what may separate two numbers: white space, with at most one comma. Returns whether
   * it skipped a comma, which a number must follow.
   */
  skipSeparator(): boolean {
    this.skipWhitespace();
    if (this.next !== ",") {
      return false;
    }
    this.position += 1;
    this.skipWhitespace();
    return true;
  }

  /** Whether a number may start here: a digit, a sign or a point. */
  get atNumber(): boolean {
    return /[\d+.-]/.test(this.next);
  }

  /** Two numbers, as a coordinate pair, relative to `base`. */
  point(base: Point): Point {
    const x = this.number();
    this.skipSeparator();
    return { x: base.x + x, y: base.y + this.number() };
  }

  number(): number {
    NUMBER.lastIndex = this.position;
    const match = NUMBER.exec(this.data);
    if (match === null) {
      throw new PathError("Expected a number", this.position);
    }
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      throw new PathError("The number is too large", this.position);
    }
    this.position += match[0].length;
    return value;
  }

  /** An arc's flag: 0 or 1, which nothing needs to separate from what follows. */
  flag(): boolean {
    const flag = this.next;
    if (flag !== "0" && flag !== "1") {
      throw new PathError("Expected a flag, 0 or 1", this.position);
    }
    this.position += 1;
    return flag === "1";
  }
}

function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

/**
 * The cubic curves that draw an elliptical arc from `from` to `to` (SVG 2, §B.2.4 and §B.2.5),
 * one per eighth of a turn at most, each within a hundred-thousandth of the radius. An arc to its
 * own start is left out, and one with a zero radius is a line.
 */
export function arcToCubics(
  from: Point,
  radiusX: number,
  radiusY: number,
  rotation: number,
  largeArc: boolean,
  sweep: boolean,
  to: Point,
): Piece[] {
  if (from.x === to.x && from.y === to.y) {
    return [];
  }
  let rx = Math.abs(radiusX);
  let ry = Math.abs(radiusY);
  if (rx === 0 || ry === 0) {
    return [{ kind: "line", to }];
  }
  const phi = ((rotation % 360) * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const halfX = (from.x - to.x) / 2;
  const halfY = (from.y - to.y) / 2;
  const x1 = cos * halfX + sin * halfY;
  const y1 = -sin * halfX + cos * halfY;
  // Radii too small to reach the end grow until they just do.
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const root = Math.sqrt(Math.max(0, numerator / denominator)) * (largeArc === sweep ? -1 : 1);
  const centerX1 = (root * rx * y1) / ry;
  const centerY1 = (-root * ry * x1) / rx;
  const centerX = cos * centerX1 - sin * centerY1 + (from.x + to.x) / 2;
  const centerY = sin * centerX1 + cos * centerY1 + (from.y + to.y) / 2;
  const ux = (x1 - centerX1) / rx;
  const uy = (y1 - centerY1) / ry;
  const start = angleBetween(1, 0, ux, uy);
  let extent = angleBetween(ux, uy, (-x1 - centerX1) / rx, (-y1 - centerY1) / ry);
  if (!sweep && extent > 0) {
    extent -= 2 * Math.PI;
  } else if (sweep && extent < 0) {
    extent += 2 * Math.PI;
  }

  const count = Math.max(1, Math.ceil(Math.abs(extent) / (Math.PI / 4) - 1e-9));
  const step = extent / count;
  // How far the control points lie along the tangents, in radii: the curve then meets the arc
  // at its ends and its middle, and strays from it by less than 5e-6 radii over an eighth turn.
  const k = (4 / 3) * Math.tan(step / 4);
  const onEllipse = (x: number, y: number): Point => ({
    x: centerX + rx * cos * x - ry * sin * y,
    y: centerY + rx * sin * x + ry * cos * y,
  });
  const pieces: Piece[] = [];
  for (let index = 0; index < count; index += 1) {
    const a = start + index * step;
    const b = a + step;
    pieces.push({
      kind: "cubic",
      c1: onEllipse(Math.cos(a) - k * Math.sin(a), Math.sin(a) + k * Math.cos(a)),
      c2: onEllipse(Math.cos(b) + k * Math.sin(b), Math.sin(b) - k * Math.cos(b)),
      // The last curve ends exactly where the arc does.
      to: index === count - 1 ? to : onEllipse(Math.cos(b), Math.sin(b)),
    });
  }
  return pieces;
}

/** The cubic curve that is the quadratic curve from `from`, with the control point `control`. */
function quadraticToCubic(from: Point, control: Point, to: Point): Piece {
  return {
    kind: "cubic",
    c1: { x: from.x + (2 / 3) * (control.x - from.x), y: from.y + (2 / 3) * (control.y - from.y) },
    c2: { x: to.x + (2 / 3) * (control.x - to.x), y: to.y + (2 / 3) * (control.y - to.y) },
    to,
  };
}

function reflect(point: Point, center: Point): Point {
  return { x: 2 * center.x - point.x, y: 2 * center.y - point.y };
}

/**
 * Parses SVG path data into its subpaths. Every command of SVG 2 is understood, relative or
 * absolute, with repeated arguments and every way of separating numbers. Data that does not
 * follow the grammar throws a `PathError`, rather than drawing the part before the error as
 * browsers do: an icon should be drawn whole or not at all.
 */
export function parsePath(data: string): Subpath[] {
  const scanner = new Scanner(data);
  const subpaths: Subpath[] = [];
  let pieces: Piece[] = [];
  let start: Point = { x: 0, y: 0 };
  let current: Point = { x: 0, y: 0 };
  // Where a subpath that a drawing command starts after a close begins.
  let open = false;
  // The control point that a smooth curve reflects, after a curve of its own kind.
  let lastCubic: Point | undefined;
  let lastQuadratic: Point | undefined;

  const begin = (point: Point): void => {
    if (open) {
      subpaths.push({ start, pieces });
    }
    start = point;
    current = point;
    pieces = [];
    open = true;
  };
  const add = (piece: Piece): void => {
    if (!open) {
      // A drawing command after a close starts a new subpath where the closed one started.
      begin(current);
    }
    pieces.push(piece);
    current = piece.to;
  };

  scanner.skipWhitespace();
  if (scanner.done) {
    return [];
  }
  if (scanner.next !== "M" && scanner.next !== "m") {
    throw new PathError("Path data must start with a move", scanner.position);
  }
  while (!scanner.done) {
    const letter = scanner.next;
    const command = letter.toUpperCase();
    const count = ARGUMENTS[command];
    if (count === undefined) {
      throw new PathError(`Unknown command "${letter}"`, scanner.position);
    }
    const relative = letter !== command;
    scanner.position += 1;
    scanner.skipWhitespace();
    let repetition = 0;
    do {
      const base = relative ? current : { x: 0, y: 0 };
      let cubicControl: Point | undefined;
      let quadraticControl: Point | undefined;
      if (command === "Z") {
        if (open) {
          subpaths.push({ start, pieces });
          open = false;
        }
        current = start;
        pieces = [];
      } else if (command === "M") {
        const to = scanner.point(base);
        if (repetition === 0) {
          begin(to);
        } else {
          // Further pairs after a move are lines.
          add({ kind: "line", to });
        }
      } else if (command === "L") {
        add({ kind: "line", to: scanner.point(base) });
      } else if (command === "H") {
        add({ kind: "line", to: { x: base.x + scanner.number(), y: current.y } });
      } else if (command === "V") {
        add({ kind: "line", to: { x: current.x, y: base.y + scanner.number() } });
      } else if (command === "C" || command === "S") {
        let c1: Point;
        if (command === "C") {
          c1 = scanner.point(base);
          scanner.skipSeparator();
        } else {
          c1 = reflect(lastCubic ?? current, current);
        }
        const c2 = scanner.point(base);
        scanner.skipSeparator();
        add({ kind: "cubic", c1, c2, to: scanner.point(base) });
        cubicControl = c2;
      } else if (command === "Q" || command === "T") {
        const from = current;
        let control: Point;
        if (command === "Q") {
          control = scanner.point(base);
          scanner.skipSeparator();
        } else {
          control = reflect(lastQuadratic ?? current, current);
        }
        add(quadraticToCubic(from, control, scanner.point(base)));
        quadraticControl = control;
      } else {
        const from = current;
        const rx = scanner.number();
        scanner.skipSeparator();
        const ry = scanner.number();
        scanner.skipSeparator();
        const rotation = scanner.number();
        scanner.skipSeparator();
        const largeArc = scanner.flag();
        scanner.skipSeparator();
        const sweep = scanner.flag();
        scanner.skipSeparator();
        const to = scanner.point(base);
        for (const piece of arcToCubics(from, rx, ry, rotation, largeArc, sweep, to)) {
          add(piece);
        }
      }
      lastCubic = cubicControl;
      lastQuadratic = quadraticControl;
      repetition += 1;
      if (count === 0) {
        scanner.skipWhitespace();
        break;
      }
      if (scanner.skipSeparator() && !scanner.atNumber) {
        throw new PathError("Expected a number after the comma", scanner.position);
      }
    } while (!scanner.done && scanner.atNumber);
    if (!scanner.done && !/[A-Za-z]/.test(scanner.next)) {
      throw new PathError("Expected a command", scanner.position);
    }
  }
  if (open) {
    subpaths.push({ start, pieces });
  }
  return subpaths;
}
