import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Point, parsePath, type Subpath } from "./path.ts";
import { Accumulator, type FillRule, fill, flatten } from "./raster.ts";

const AS_IS = { scale: 1, dx: 0, dy: 0 };

/** A polygon through `points`, as a subpath of lines. */
function polygon(points: readonly Point[]): Subpath {
  const [start = { x: 0, y: 0 }, ...rest] = points;
  return { start, pieces: rest.map((to) => ({ kind: "line", to })) };
}

function rectangle(x0: number, y0: number, x1: number, y1: number): Subpath {
  return polygon([
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ]);
}

/** How much of the span from a to b, in either order, lies within 0 to 16. */
function within(a: number, b: number): number {
  return Math.max(0, Math.min(16, Math.max(a, b)) - Math.max(0, Math.min(a, b)));
}

/** The coverage of the middle and of a corner of a grid of 4 by 4, filled by `rule`. */
function centre(subpaths: Subpath[], rule: FillRule): number[] {
  const coverage = fill(subpaths, AS_IS, 4, 4, rule);
  return [coverage[5] ?? -1, coverage[0] ?? -1];
}

function sum(values: Float32Array): number {
  return values.reduce((total, value) => total + value, 0);
}

/** The coverage of each pixel of a small grid, as rows of numbers rounded to 1/1000. */
function rows(coverage: Float32Array, width: number): number[][] {
  const result: number[][] = [];
  for (let start = 0; start < coverage.length; start += width) {
    result.push(
      [...coverage.subarray(start, start + width)].map((value) => Math.round(value * 1000) / 1000),
    );
  }
  return result;
}

describe("fill", () => {
  it("covers the pixels of a rectangle on the grid fully, and no others", () => {
    expect(rows(fill([rectangle(1, 1, 3, 2)], AS_IS, 4, 3, "nonzero"), 4)).toStrictEqual([
      [0, 0, 0, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
    ]);
  });

  it("covers the share of each pixel that a shape covers", () => {
    // Half a pixel wide and high at the edges: the corners get a quarter.
    expect(rows(fill([rectangle(0.5, 0.5, 2.5, 1.5)], AS_IS, 3, 2, "nonzero"), 3)).toStrictEqual([
      [0.25, 0.5, 0.25],
      [0.25, 0.5, 0.25],
    ]);
    // A triangle that cuts a pixel along its diagonal covers half of it.
    expect(
      rows(
        fill(
          [
            polygon([
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0, y: 1 },
            ]),
          ],
          AS_IS,
          1,
          1,
          "nonzero",
        ),
        1,
      ),
    ).toStrictEqual([[0.5]]);
    // A thin line across many pixels: each gets its share of the triangle under it.
    expect(
      rows(
        fill(
          [
            polygon([
              { x: 0, y: 0 },
              { x: 4, y: 1 },
              { x: 0, y: 1 },
            ]),
          ],
          AS_IS,
          4,
          1,
          "nonzero",
        ),
        4,
      ),
    ).toStrictEqual([[0.875, 0.625, 0.375, 0.125]]);
  });

  it("covers as much area as a polygon has, and no pixel more than fully", () => {
    const coordinate = fc.double({ min: 0, max: 16, noNaN: true });
    const point = fc.tuple(coordinate, coordinate).map(([x, y]): Point => ({ x, y }));
    fc.assert(
      fc.property(fc.tuple(point, point, point), (corners) => {
        const [a, b, c] = corners;
        const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
        const coverage = fill([polygon(corners)], AS_IS, 16, 16, "nonzero");
        expect(Math.abs(sum(coverage) - area)).toBeLessThan(1e-6 * Math.max(1, area));
        for (const value of coverage) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }),
    );
  });

  it("covers the same pixels whichever way a shape goes round", () => {
    const coordinate = fc.double({ min: -4, max: 20, noNaN: true });
    const point = fc.tuple(coordinate, coordinate).map(([x, y]): Point => ({ x, y }));
    fc.assert(
      fc.property(fc.array(point, { minLength: 3, maxLength: 7 }), (corners) => {
        const forward = fill([polygon(corners)], AS_IS, 16, 16, "nonzero");
        const backward = fill([polygon(corners.toReversed())], AS_IS, 16, 16, "nonzero");
        for (const [index, value] of forward.entries()) {
          expect(Math.abs(value - (backward[index] ?? 0))).toBeLessThan(1e-5);
        }
      }),
    );
  });

  it("fills the grid with what lies beyond its left and right edges, and leaves out the rest", () => {
    // Wider than the grid on both sides, and taller: every pixel is covered once.
    const wide = fill([rectangle(-5.3, -2, 9.7, 7)], AS_IS, 4, 3, "nonzero");
    expect([...wide]).toStrictEqual(Array.from({ length: 12 }, () => 1));
    // A slanted edge that crosses the left edge of the grid within a row.
    expect(
      rows(
        fill(
          [
            polygon([
              { x: -1, y: 0 },
              { x: 4, y: 0 },
              { x: 4, y: 1 },
              { x: 1, y: 1 },
            ]),
          ],
          AS_IS,
          4,
          1,
          "nonzero",
        ),
        4,
      ),
    ).toStrictEqual([[0.75, 1, 1, 1]]);
    // Its mirror image, across the right edge.
    expect(
      rows(
        fill(
          [
            polygon([
              { x: 0, y: 0 },
              { x: 5, y: 0 },
              { x: 3, y: 1 },
              { x: 0, y: 1 },
            ]),
          ],
          AS_IS,
          4,
          1,
          "nonzero",
        ),
        4,
      ),
    ).toStrictEqual([[1, 1, 1, 0.75]]);
    // Wholly outside: nothing.
    expect(sum(fill([rectangle(-9, 0, -1, 3)], AS_IS, 4, 3, "nonzero"))).toBe(0);
  });

  it("covers what a shape covers within the grid, wherever it lies", () => {
    const coordinate = fc.double({ min: -10, max: 26, noNaN: true });
    fc.assert(
      fc.property(coordinate, coordinate, coordinate, coordinate, (x0, y0, x1, y1) => {
        const expected = within(x0, x1) * within(y0, y1);
        const coverage = fill([rectangle(x0, y0, x1, y1)], AS_IS, 16, 16, "nonzero");
        expect(Math.abs(sum(coverage) - expected)).toBeLessThan(1e-6 * Math.max(1, expected));
      }),
    );
  });

  it("draws edges of any height, down to the smallest numbers", () => {
    // Found by the property above: an edge 5e-323 pixels high made the slope infinite, and the
    // loop over its pixels never ended.
    const corners = [
      { x: -2.3584591949537754e-262, y: -4.805519686743595e-10 },
      { x: 2e-323, y: 2.5e-323 },
      { x: 19.99999999999996, y: 7.4e-323 },
      { x: -8.60958936997886e-99, y: -2e-323 },
    ];
    for (const shape of [corners, corners.toReversed()]) {
      const coverage = fill([polygon(shape)], AS_IS, 16, 16, "nonzero");
      expect(sum(coverage)).toBeLessThan(1e-6);
    }
    const tiny = fc.double({ min: -1e-300, max: 1e-300, noNaN: true });
    const x = fc.double({ min: -4, max: 20, noNaN: true });
    fc.assert(
      fc.property(fc.array(fc.tuple(x, tiny), { minLength: 3, maxLength: 5 }), (points) => {
        const flat = points.map(([px, py]): Point => ({ x: px, y: py }));
        // A shape without height covers nothing.
        expect(sum(fill([polygon(flat)], AS_IS, 16, 16, "nonzero"))).toBeLessThan(1e-6);
      }),
    );
  });

  it("leaves a hole that goes round the other way, and fills overlaps by the rule", () => {
    const outer = rectangle(0, 0, 4, 4);
    const inner = rectangle(1, 1, 3, 3);
    const reversed = polygon([
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 1 },
    ]);
    // [the middle, a corner]
    expect(centre([outer, reversed], "nonzero")).toStrictEqual([0, 1]);
    expect(centre([outer, reversed], "evenodd")).toStrictEqual([0, 1]);
    expect(centre([outer, inner], "nonzero")).toStrictEqual([1, 1]);
    expect(centre([outer, inner], "evenodd")).toStrictEqual([0, 1]);
  });

  it("draws curves within the tolerance: a circle covers π r², but for a band of 0.02 pixels", () => {
    for (const radius of [0.75, 3, 7.5, 100]) {
      const size = Math.ceil(2 * radius) + 2;
      const c = size / 2;
      const circle = parsePath(
        `M${c - radius} ${c}a${radius} ${radius} 0 1 0 ${2 * radius} 0a${radius} ${radius} 0 1 0 ${-2 * radius} 0Z`,
      );
      const area = sum(fill(circle, AS_IS, size, size, "nonzero"));
      // The lines stray from the curve by 0.02 pixels at most, inwards.
      const missing = Math.PI * radius * radius - area;
      expect({
        radius,
        withinBand: missing > -1e-6 && missing < 2 * Math.PI * radius * 0.02,
      }).toStrictEqual({
        radius,
        withinBand: true,
      });
    }
  });

  it("places a shape by the scale and offset it is given", () => {
    const unit = [rectangle(0, 0, 1, 1)];
    expect(rows(fill(unit, { scale: 2, dx: 1, dy: 0 }, 4, 2, "nonzero"), 4)).toStrictEqual([
      [0, 1, 1, 0],
      [0, 1, 1, 0],
    ]);
  });
});

describe("flatten", () => {
  it("keeps lines as they are, and draws a curve with more lines the more it bends", () => {
    const [straight] = parsePath("M0 0L10 0L10 10");
    expect(flatten(straight ?? polygon([]), AS_IS)).toStrictEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    const [gentle] = parsePath("M0 0C10 1 20 1 30 0");
    const [sharp] = parsePath("M0 0C10 30 20 30 30 0");
    const gentleLines = flatten(gentle ?? polygon([]), AS_IS).length;
    const sharpLines = flatten(sharp ?? polygon([]), AS_IS).length;
    expect(gentleLines).toBeGreaterThan(2);
    expect(sharpLines).toBeGreaterThan(gentleLines);
    // A curve that is a straight line needs one line.
    const [flat] = parsePath("M0 0C1 0 2 0 3 0");
    expect(flatten(flat ?? polygon([]), AS_IS)).toHaveLength(2);
  });
});

describe("Accumulator", () => {
  it("refuses grids that cannot be", () => {
    expect(() => new Accumulator(0, 4)).toThrow(RangeError);
    expect(() => new Accumulator(4, 2.5)).toThrow(RangeError);
  });

  it("ignores edges without height, or with a coordinate that is no number", () => {
    const grid = new Accumulator(2, 2);
    grid.line({ x: 0, y: 1 }, { x: 2, y: 1 });
    grid.line({ x: Number.NaN, y: 0 }, { x: 1, y: 2 });
    grid.line({ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 2 });
    expect([...grid.coverage("nonzero")]).toStrictEqual([0, 0, 0, 0]);
  });
});
