/**
 * Fills shapes on a grid of pixels with exact area coverage, as anti-aliasing needs: each pixel
 * gets the share of its area that the shape covers. Each edge of a shape adds the signed area
 * that it bounds to its pixels, and a running sum along each row gives the coverage, so the cost
 * grows with the edges' length, not with the number of shapes.
 */

import type { Piece, Point, Subpath } from "./path.ts";

/** How a shape whose subpaths overlap is filled, as SVG's `fill-rule`. */
export type FillRule = "nonzero" | "evenodd";

/** How far a flattened curve may stray from the curve, in pixels. */
const TOLERANCE = 0.02;

/** Coverage this close to 0 or 1 is exactly 0 or 1. */
const SNAP = 1e-9;

/** Maps path coordinates to pixels: `x * scale + dx`, `y * scale + dy`. */
export interface Placement {
  readonly scale: number;
  readonly dx: number;
  readonly dy: number;
}

function place({ x, y }: Point, { scale, dx, dy }: Placement): Point {
  return { x: x * scale + dx, y: y * scale + dy };
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/**
 * How many lines draw a cubic curve within `TOLERANCE` of it (Wang's formula): it grows with
 * the curve's bend, which its control points' second differences bound.
 */
function lineCount(p0: Point, p1: Point, p2: Point, p3: Point): number {
  const bend = Math.max(
    Math.hypot(p0.x - 2 * p1.x + p2.x, p0.y - 2 * p1.y + p2.y),
    Math.hypot(p1.x - 2 * p2.x + p3.x, p1.y - 2 * p2.y + p3.y),
  );
  return Math.min(1000, Math.max(1, Math.ceil(Math.sqrt((0.75 * bend) / TOLERANCE))));
}

/** The corners of the polygon that approximates `subpath` in pixels, closed by the fill. */
export function flatten(subpath: Subpath, placement: Placement): Point[] {
  let from = place(subpath.start, placement);
  const points = [from];
  const append = (piece: Piece): void => {
    const to = place(piece.to, placement);
    if (piece.kind === "cubic") {
      const c1 = place(piece.c1, placement);
      const c2 = place(piece.c2, placement);
      const count = lineCount(from, c1, c2, to);
      for (let index = 1; index < count; index += 1) {
        points.push(cubicAt(from, c1, c2, to, index / count));
      }
    }
    points.push(to);
    from = to;
  };
  for (const piece of subpath.pieces) {
    append(piece);
  }
  return points;
}

/** Collects the signed area that the edges of shapes bound, pixel by pixel, on a grid. */
export class Accumulator {
  /** One more cell than pixels: an edge on a row's right border adds to the next one's start. */
  readonly #cells: Float64Array;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError(`A grid of ${width} by ${height} pixels is not possible.`);
    }
    this.width = width;
    this.height = height;
    this.#cells = new Float64Array(width * height + 1);
  }

  /**
   * Adds the edge from `a` to `b`. What lies left of the grid counts at its left border, and
   * what lies right of it at its right border, so that a shape larger than the grid fills it.
   */
  line(a: Point, b: Point): void {
    if (a.y === b.y || !Number.isFinite(a.x + a.y + b.x + b.y)) {
      return;
    }
    // Split where the edge crosses a border, so that each part is inside or outside the grid.
    const cuts = [0, 1];
    for (const border of [0, this.width]) {
      const t = (border - a.x) / (b.x - a.x);
      if (t > 0 && t < 1) {
        cuts.push(t);
      }
    }
    cuts.sort((x, y) => x - y);
    const at = (t: number): Point => ({
      x: Math.min(this.width, Math.max(0, a.x + t * (b.x - a.x))),
      y: a.y + t * (b.y - a.y),
    });
    for (let index = 1; index < cuts.length; index += 1) {
      this.#edge(at(cuts[index - 1] ?? 0), at(cuts[index] ?? 1));
    }
  }

  /** Adds an edge that lies within the grid's width, row by row. */
  #edge(a: Point, b: Point): void {
    if (a.y === b.y) {
      return;
    }
    const direction = a.y < b.y ? 1 : -1;
    const [top, bottom] = a.y < b.y ? [a, b] : [b, a];
    // Where the edge is at height y, from the share of its height above y, which lies between 0
    // and 1: a slope, the width over the height, would overflow for an edge 1e-320 pixels high.
    const height = bottom.y - top.y;
    const xAt = (y: number): number =>
      Math.min(this.width, Math.max(0, top.x + (bottom.x - top.x) * ((y - top.y) / height)));
    const first = Math.max(0, Math.floor(top.y));
    const last = Math.min(this.height, Math.ceil(bottom.y));
    for (let row = first; row < last; row += 1) {
      const y0 = Math.max(row, top.y);
      const y1 = Math.min(row + 1, bottom.y);
      if (y1 > y0) {
        this.#span(row * this.width, xAt(y0), xAt(y1), (y1 - y0) * direction);
      }
    }
  }

  /**
   * Adds the part of an edge within one row, from `x0` to `x1`, which spans `height` of the row
   * (negative for an edge going up). Each pixel gains the share of its area that lies right of
   * the edge, times `height`; the cells hold the differences between neighbors, which the
   * running sum of a row turns back into coverage.
   */
  #span(start: number, x0: number, x1: number, height: number): void {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    // The mean over the edge's span of how far x lies right of the edge, at least 0: the edge's
    // x is spread evenly from left to right as it crosses the row.
    const ramp = (x: number): number => {
      if (x <= left) {
        return 0;
      }
      if (x >= right) {
        return x - (left + right) / 2;
      }
      return ((x - left) * (x - left)) / (2 * (right - left));
    };
    // The share of pixel p, from p to p + 1, right of the edge, times the height.
    const covered = (pixel: number): number => height * (ramp(pixel + 1) - ramp(pixel));
    const firstPixel = Math.floor(left);
    const lastPixel = Math.max(firstPixel, Math.ceil(right) - 1);
    const cells = this.#cells;
    for (let pixel = firstPixel; pixel <= lastPixel + 1; pixel += 1) {
      const cell = start + pixel;
      if (cell < cells.length) {
        cells[cell] = (cells[cell] ?? 0) + covered(pixel) - covered(pixel - 1);
      }
    }
  }

  /** How much of each pixel the shapes cover, from 0 to 1, row by row from the top left. */
  coverage(rule: FillRule): Float32Array {
    const cells = this.#cells;
    const result = new Float32Array(this.width * this.height);
    let sum = 0;
    for (let index = 0; index < result.length; index += 1) {
      sum += cells[index] ?? 0;
      const winding = Math.abs(sum);
      // Even-odd: an area that two shapes cover is empty, and anti-aliased edges stay smooth.
      const value = Math.min(1, rule === "nonzero" ? winding : 1 - Math.abs(1 - (winding % 2)));
      // The running sum carries rounding errors of about 1e-12: snap them away, so that a pixel
      // that a shape misses or covers is exactly empty or full.
      result[index] = value < SNAP ? 0 : value > 1 - SNAP ? 1 : value;
    }
    return result;
  }
}

/** How much of each pixel of a grid the subpaths cover, filled by `rule`, from 0 to 1. */
export function fill(
  subpaths: readonly Subpath[],
  placement: Placement,
  width: number,
  height: number,
  rule: FillRule,
): Float32Array {
  const grid = new Accumulator(width, height);
  for (const subpath of subpaths) {
    const points = flatten(subpath, placement);
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      // Every subpath is closed: its last corner joins its first.
      const b = points[(index + 1) % points.length];
      if (a !== undefined && b !== undefined) {
        grid.line(a, b);
      }
    }
  }
  return grid.coverage(rule);
}
