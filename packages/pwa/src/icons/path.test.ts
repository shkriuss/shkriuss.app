import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arcToCubics, type Piece, PathError, type Point, parsePath, type Subpath } from "./path.ts";

const line = (x: number, y: number): Piece => ({ kind: "line", to: { x, y } });

/** The point of a cubic piece from `from` at `t`. */
function cubicAt(from: Point, piece: Piece, t: number): Point {
  if (piece.kind !== "cubic") {
    return piece.to;
  }
  const u = 1 - t;
  const at = (a: number, b: number, c: number, d: number): number =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
  return {
    x: at(from.x, piece.c1.x, piece.c2.x, piece.to.x),
    y: at(from.y, piece.c1.y, piece.c2.y, piece.to.y),
  };
}

/** Expects `piece` to be the cubic piece `expected`, but for rounding. */
function expectPiece(
  piece: Piece | undefined,
  expected: { readonly c1: Point; readonly c2: Point; readonly to: Point },
): void {
  const points = piece?.kind === "cubic" ? [piece.c1, piece.c2, piece.to] : [];
  const rounded = points.map(({ x, y }) => [x.toFixed(12), y.toFixed(12)]);
  expect(rounded).toStrictEqual(
    [expected.c1, expected.c2, expected.to].map(({ x, y }) => [x.toFixed(12), y.toFixed(12)]),
  );
}

/** Points along every piece of `subpath`, with the piece's start. */
function along(subpath: Subpath): Point[] {
  const points: Point[] = [];
  let from = subpath.start;
  for (const piece of subpath.pieces) {
    for (let step = 0; step <= 16; step += 1) {
      points.push(cubicAt(from, piece, step / 16));
    }
    from = piece.to;
  }
  return points;
}

describe("parsePath", () => {
  it("reads lines in every way of separating numbers", () => {
    const expected: Subpath[] = [{ start: { x: 1, y: 2 }, pieces: [line(3, 4), line(-5, 0.5)] }];
    for (const data of [
      "M1 2 L3 4 L-5 .5",
      "M1,2L3,4L-5,.5",
      "M 1 , 2 L 3 , 4 L -5 , 0.5 ",
      "\n\tM1 2\rL3\f4-5,.5",
      "M1 2 3 4 -5 .5",
      "M1e0 2E0L3 4l-8-3.5",
    ]) {
      expect({ data, subpaths: parsePath(data) }).toStrictEqual({ data, subpaths: expected });
    }
    for (const data of ["M1 2L3 4H-5V.5", "m1 2l2 2h-8v-3.5"]) {
      expect({ data, subpaths: parsePath(data) }).toStrictEqual({
        data,
        subpaths: [{ start: { x: 1, y: 2 }, pieces: [line(3, 4), line(-5, 4), line(-5, 0.5)] }],
      });
    }
  });

  it("reads numbers that run into each other, as SVG allows", () => {
    expect(parsePath("M0.5.5L1-1")).toStrictEqual([
      { start: { x: 0.5, y: 0.5 }, pieces: [line(1, -1)] },
    ]);
  });

  it("starts each subpath at a move, and after a close where the closed one started", () => {
    expect(parsePath("M0 0L1 0L1 1ZL2 2M5 5l1 0z m1 1l1 1")).toStrictEqual([
      { start: { x: 0, y: 0 }, pieces: [line(1, 0), line(1, 1)] },
      { start: { x: 0, y: 0 }, pieces: [line(2, 2)] },
      { start: { x: 5, y: 5 }, pieces: [line(6, 5)] },
      { start: { x: 6, y: 6 }, pieces: [line(7, 7)] },
    ]);
  });

  it("reads a first relative move from the origin, and moves without lines", () => {
    expect(parsePath("m2 3M4 5")).toStrictEqual([
      { start: { x: 2, y: 3 }, pieces: [] },
      { start: { x: 4, y: 5 }, pieces: [] },
    ]);
    expect(parsePath("  ")).toStrictEqual([]);
  });

  it("reads cubic curves, and reflects the last control point for smooth ones", () => {
    expect(parsePath("M0 0C1 2 3 4 5 6S9 10 11 12s1 1 2 2")).toStrictEqual([
      {
        start: { x: 0, y: 0 },
        pieces: [
          { kind: "cubic", c1: { x: 1, y: 2 }, c2: { x: 3, y: 4 }, to: { x: 5, y: 6 } },
          { kind: "cubic", c1: { x: 7, y: 8 }, c2: { x: 9, y: 10 }, to: { x: 11, y: 12 } },
          { kind: "cubic", c1: { x: 13, y: 14 }, c2: { x: 12, y: 13 }, to: { x: 13, y: 14 } },
        ],
      },
    ]);
    // A smooth curve after anything but a cubic one starts at the current point.
    const [smooth] = parsePath("M0 0L4 0S6 2 8 0");
    expect(smooth?.pieces[1]).toStrictEqual({
      kind: "cubic",
      c1: { x: 4, y: 0 },
      c2: { x: 6, y: 2 },
      to: { x: 8, y: 0 },
    });
  });

  it("turns quadratic curves into the cubic curves that they are", () => {
    const [subpath] = parsePath("M0 0Q2 4 4 0T8 0");
    const [first, second] = subpath?.pieces ?? [];
    expectPiece(first, {
      c1: { x: 4 / 3, y: 8 / 3 },
      c2: { x: 8 / 3, y: 8 / 3 },
      to: { x: 4, y: 0 },
    });
    // The smooth one reflects (2, 4) through (4, 0): its control point is (6, -4).
    expectPiece(second, {
      c1: { x: 4 + (2 / 3) * 2, y: (2 / 3) * -4 },
      c2: { x: 8 + (2 / 3) * -2, y: (2 / 3) * -4 },
      to: { x: 8, y: 0 },
    });
    // At its middle, a quadratic curve is at P0 / 4 + P1 / 2 + P2 / 4.
    const middle = cubicAt({ x: 0, y: 0 }, first ?? line(0, 0), 0.5);
    expect(middle.x).toBeCloseTo(2, 12);
    expect(middle.y).toBeCloseTo(2, 12);
  });

  it("reads arcs, with flags that nothing separates from the numbers after them", () => {
    const [arc] = parsePath("M0 0a1 1 0 00 2 0");
    expect(arc?.pieces).toHaveLength(4);
    expect(arc?.pieces.at(-1)?.to).toStrictEqual({ x: 2, y: 0 });
    for (const point of along(arc ?? { start: { x: 0, y: 0 }, pieces: [] })) {
      expect(Math.abs(Math.hypot(point.x - 1, point.y) - 1)).toBeLessThan(1e-5);
      // Sweep 0 turns counterclockwise on a screen, where y grows downwards: below the line.
      expect(point.y).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it("refuses data that does not follow the grammar, and says where", () => {
    const cases: [string, string, number][] = [
      ["L0 0", "must start with a move", 0],
      ["M0", "Expected a number", 2],
      ["M0 0 X1 1", 'Unknown command "X"', 5],
      ["M0 0L1 1,", "Expected a number after the comma", 9],
      ["M0 0L1 1, L2 2", "Expected a number after the comma", 10],
      ["M0 0Z1 1", "Expected a command", 5],
      ["M0 0A1 1 0 2 0 1 1", "Expected a flag", 11],
      ["M0 0L1e999 0", "too large", 5],
      ["M0 0L1 1#", "Expected a command", 8],
    ];
    for (const [data, message, position] of cases) {
      let failure: unknown;
      try {
        parsePath(data);
      } catch (error) {
        failure =
          error instanceof PathError
            ? { position: error.position, says: error.message.includes(message) }
            : error;
      }
      expect({ data, failure }).toStrictEqual({ data, failure: { position, says: true } });
    }
  });

  it("reads back every polygon that it is given", () => {
    // Without -0, which path data writes as 0.
    const coordinate = fc.double({ min: -1000, max: 1000, noNaN: true }).map((value) => value + 0);
    const point = fc.tuple(coordinate, coordinate).map(([x, y]): Point => ({ x, y }));
    fc.assert(
      fc.property(
        fc.array(fc.array(point, { minLength: 1, maxLength: 8 }), { maxLength: 4 }),
        (polygons) => {
          const data = polygons
            .map(
              ([first, ...rest]) =>
                `M${first?.x} ${first?.y}${rest.map(({ x, y }) => `L${x},${y}`).join("")}Z`,
            )
            .join(" ");
          expect(parsePath(data)).toStrictEqual(
            polygons.map(([first, ...rest]) => ({
              start: first,
              pieces: rest.map(({ x, y }) => line(x, y)),
            })),
          );
        },
      ),
    );
  });
});

describe("arcToCubics", () => {
  const from = { x: 0, y: 0 };

  it("draws a line for a zero radius, and nothing for an arc to its own start", () => {
    expect(arcToCubics(from, 0, 5, 0, false, true, { x: 3, y: 4 })).toStrictEqual([line(3, 4)]);
    expect(arcToCubics(from, 5, 5, 0, false, true, from)).toStrictEqual([]);
  });

  it("grows radii too small to reach the end, into a half ellipse", () => {
    const pieces = arcToCubics(from, 0.5, 0.5, 0, false, true, { x: 4, y: 0 });
    const subpath = { start: from, pieces };
    for (const point of along(subpath)) {
      expect(Math.abs(Math.hypot(point.x - 2, point.y) - 2)).toBeLessThan(2e-5);
    }
  });

  it("goes the way of its sweep flag", () => {
    // From (0, 0) to (2, 0) on the circle around (1, 0): sweep 1 turns the positive way, which
    // is clockwise on a screen, where y grows downwards; so it passes above the line.
    const above = along({
      start: from,
      pieces: arcToCubics(from, 1, 1, 0, false, true, { x: 2, y: 0 }),
    });
    expect(Math.min(...above.map((point) => point.y))).toBeCloseTo(-1, 5);
    const below = along({
      start: from,
      pieces: arcToCubics(from, 1, 1, 0, false, false, { x: 2, y: 0 }),
    });
    expect(Math.max(...below.map((point) => point.y))).toBeCloseTo(1, 5);
  });

  it("stays on the ellipse, with its rotation, and ends exactly at the end", () => {
    const radius = fc.double({ min: 0.5, max: 100, noNaN: true });
    const coordinate = fc.double({ min: -100, max: 100, noNaN: true });
    fc.assert(
      fc.property(
        radius,
        radius,
        fc.double({ min: -720, max: 720, noNaN: true }),
        fc.boolean(),
        fc.boolean(),
        coordinate,
        coordinate,
        (rx, ry, rotation, largeArc, sweep, x, y) => {
          fc.pre(Math.hypot(x, y) > 1e-3);
          const to = { x, y };
          const pieces = arcToCubics(from, rx, ry, rotation, largeArc, sweep, to);
          expect(pieces.at(-1)?.to).toStrictEqual(to);
          expect(pieces.length).toBeLessThanOrEqual(8);
          // In the ellipse's own axes, each scaled by its radius, the arc is part of a circle.
          const phi = (rotation * Math.PI) / 180;
          const circle = along({ start: from, pieces }).map((point) => ({
            x: (Math.cos(phi) * point.x + Math.sin(phi) * point.y) / rx,
            y: (-Math.sin(phi) * point.x + Math.cos(phi) * point.y) / ry,
          }));
          const center = circumcenter(
            circle[0] ?? from,
            circle[Math.floor(circle.length / 2)] ?? from,
            circle.at(-1) ?? from,
          );
          // Three points of a short arc of a large circle are too close to a line to find it.
          fc.pre(center !== undefined);
          const distance = (point: Point): number =>
            Math.hypot(point.x - center.x, point.y - center.y);
          const r = distance(circle[0] ?? from);
          for (const point of circle) {
            expect(Math.abs(distance(point) - r)).toBeLessThan(1e-4 * r);
          }
        },
      ),
    );
  });
});

/** The center of the circle through three points; `undefined` if they are almost on a line. */
function circumcenter(a: Point, b: Point, c: Point): Point | undefined {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const size = Math.max(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y));
  if (Math.abs(d) < 1e-2 * size * size) {
    return undefined;
  }
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
}
