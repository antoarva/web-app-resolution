/**
 * Healing hand-drawn zone outlines into geometry EnergyPlus will match.
 *
 * Zones traced or drawn by hand are nearly right: a wall that should be one
 * straight line across four rooms is four lines a few centimetres apart, and
 * two rooms that should share a wall either leave a sliver between them or lap
 * over each other. EnergyPlus will not pair surfaces across a gap, and it
 * reports an overlap as an error, so "nearly" is not good enough.
 *
 * The pass here works on the observation that a drawn plan is mostly made of
 * axis-aligned edges, and that every edge which *should* lie on one line is
 * already within a few centimetres of it. Collecting the coordinates those
 * edges sit at and merging the ones that agree gives a set of grid lines; every
 * vertex then moves onto the line its edges belong to. One sweep closes the
 * gaps, removes the small overlaps, and straightens a facade across as many
 * zones as it runs through, because all of those are the same fact: several
 * edges that meant to be at one coordinate.
 *
 * What it will not do is move anything further than the tolerance, invent or
 * drop a zone, or reorder a ring. A zone it cannot heal without collapsing is
 * handed back untouched and named in the report, and an overlap too deep to be
 * a drawing slip is reported rather than quietly squashed.
 */

import type { Point2 } from '@/core/templates/geometry';
import { polygonArea, pointInPolygon, distanceToSegment } from './polygon';

/** Vertices and parallel edges within this distance are the same thing, in m. */
export const DEFAULT_TOLERANCE = 0.1;

export interface HealOptions {
  tolerance?: number;
}

export interface HealReport {
  /** One ring out for every ring in, with its corners in the same order. */
  rings: Point2[][];
  /** The furthest any single vertex moved, in metres. */
  moved: number;
  /** Rings left as they were, because snapping would have collapsed them. */
  skipped: number[];
  /** Ring pairs still lapping over each other by more than the tolerance. */
  overlaps: { a: number; b: number; depth: number }[];
}

interface Sample {
  value: number;
  /** How much edge sits at this coordinate: longer edges pull harder. */
  weight: number;
}

/**
 * Merges coordinates that agree to within the tolerance.
 *
 * Membership is judged against the coordinate a group opened at, never against
 * the last one added, so a ladder of values a hair apart cannot chain into one
 * group that spans the building. A group is therefore never wider than the
 * tolerance, which is what bounds how far this can move anything.
 */
function gridLines(samples: Sample[], tolerance: number): Map<number, number> {
  const sorted = [...samples].sort((one, other) => one.value - other.value);
  const lines = new Map<number, number>();

  let index = 0;
  while (index < sorted.length) {
    const anchor = sorted[index].value;
    let sum = 0;
    let weight = 0;
    let end = index;
    while (end < sorted.length && sorted[end].value - anchor <= tolerance) {
      sum += sorted[end].value * sorted[end].weight;
      weight += sorted[end].weight;
      end += 1;
    }
    // Length-weighted, so two rooms either side of a drawn wall meet in the
    // middle while a long facade barely notices a short jog joining it. A group
    // that already agrees keeps its exact value rather than being re-averaged
    // into the last bit of a float, which is what lets the pass run twice and
    // change nothing the second time.
    const settled = sorted[end - 1].value - anchor < 1e-12;
    const line = settled || weight <= 0 ? anchor : sum / weight;
    for (let at = index; at < end; at++) lines.set(sorted[at].value, line);
    index = end;
  }

  return lines;
}

type Axis = 'x' | 'y';

/**
 * Which axis an edge holds constant, if either.
 *
 * The span across the edge has to be inside the tolerance, not merely at a
 * small angle: a ten metre wall five degrees off square spans most of a metre,
 * and pulling both its ends onto one line would move them further than this
 * pass is allowed to. Judged this way, the most a vertex can travel is the
 * tolerance itself.
 */
function axisOf(start: Point2, end: Point2, tolerance: number): Axis | null {
  const spanX = Math.abs(end[0] - start[0]);
  const spanY = Math.abs(end[1] - start[1]);
  if (spanX <= tolerance && spanY > tolerance) return 'x';
  if (spanY <= tolerance && spanX > tolerance) return 'y';
  return null;
}

/** Grid resolution for finding how deep two rings lap over each other. */
const OVERLAP_SAMPLES = 16;

/**
 * How far into each other two rings reach, or 0 where they only touch.
 *
 * Corners alone are not enough to go on: two rooms drawn the same depth lap
 * over each other in a strip whose every corner lies on one boundary or the
 * other, and a point exactly on an edge is neither reliably in nor out. So the
 * strip itself is sampled, and the answer is the radius of the largest circle
 * that fits inside the shared part — nothing for a shared wall, and half the
 * width of the strip for a genuine overlap.
 */
function overlapDepth(a: Point2[], b: Point2[]): number {
  const spanOf = (ring: Point2[], axis: 0 | 1): [number, number] => [
    Math.min(...ring.map((point) => point[axis])),
    Math.max(...ring.map((point) => point[axis])),
  ];
  const [aMinX, aMaxX] = spanOf(a, 0);
  const [bMinX, bMaxX] = spanOf(b, 0);
  const [aMinY, aMaxY] = spanOf(a, 1);
  const [bMinY, bMaxY] = spanOf(b, 1);

  const minX = Math.max(aMinX, bMinX);
  const maxX = Math.min(aMaxX, bMaxX);
  const minY = Math.max(aMinY, bMinY);
  const maxY = Math.min(aMaxY, bMaxY);
  if (maxX <= minX || maxY <= minY) return 0;

  let deepest = 0;
  const consider = (point: Point2): void => {
    if (!pointInPolygon(point, a) || !pointInPolygon(point, b)) return;
    let toEdge = Infinity;
    for (const ring of [a, b]) {
      for (let i = 0; i < ring.length; i++) {
        toEdge = Math.min(toEdge, distanceToSegment(point, ring[i], ring[(i + 1) % ring.length]));
      }
    }
    deepest = Math.max(deepest, toEdge);
  };

  // Corners first, since a long thin overlap can slip between grid lines.
  for (const point of [...a, ...b]) consider(point);
  for (let i = 0; i <= OVERLAP_SAMPLES; i++) {
    for (let j = 0; j <= OVERLAP_SAMPLES; j++) {
      consider([
        minX + ((maxX - minX) * i) / OVERLAP_SAMPLES,
        minY + ((maxY - minY) * j) / OVERLAP_SAMPLES,
      ]);
    }
  }
  return deepest;
}

/**
 * Snaps a set of outlines onto shared lines, closing gaps and small overlaps.
 *
 * Rings come back in the order they went in, with the same corners in the same
 * order, so whatever the caller had them standing for still holds.
 */
export function healRings(rings: Point2[][], options: HealOptions = {}): HealReport {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const skipped: number[] = [];

  // --- Which coordinate each edge holds, and how strongly ---
  const acrossX: Sample[] = [];
  const acrossY: Sample[] = [];
  /** Per ring, per vertex: the axis lines its own edges put it on. */
  const holds = rings.map((ring) => ring.map((): { x?: number; y?: number } => ({})));

  rings.forEach((ring, index) => {
    if (ring.length < 3) return;
    for (let at = 0; at < ring.length; at++) {
      const next = (at + 1) % ring.length;
      const start = ring[at];
      const end = ring[next];
      const axis = axisOf(start, end, tolerance);
      if (axis === null) continue;

      if (axis === 'x') {
        const value = (start[0] + end[0]) / 2;
        acrossX.push({ value, weight: Math.abs(end[1] - start[1]) });
        holds[index][at].x = value;
        holds[index][next].x = value;
      } else {
        const value = (start[1] + end[1]) / 2;
        acrossY.push({ value, weight: Math.abs(end[0] - start[0]) });
        holds[index][at].y = value;
        holds[index][next].y = value;
      }
    }
  });

  const linesX = gridLines(acrossX, tolerance);
  const linesY = gridLines(acrossY, tolerance);

  // --- Move every vertex onto the lines its edges belong to ---
  let moved = 0;
  const healed = rings.map((ring, index) => ring.map((point, at) => {
    const hold = holds[index][at];
    const x = hold.x !== undefined ? linesX.get(hold.x) ?? point[0] : point[0];
    const y = hold.y !== undefined ? linesY.get(hold.y) ?? point[1] : point[1];
    moved = Math.max(moved, Math.hypot(x - point[0], y - point[1]));
    return [x, y] as Point2;
  }));

  // --- Anything that would have been flattened keeps its own shape ---
  const result = healed.map((ring, index) => {
    const original = rings[index];
    if (ring.length < 3) return original;

    const area = polygonArea(ring);
    const wasArea = polygonArea(original);
    const collapsed = ring.some((point, at) => {
      const next = ring[(at + 1) % ring.length];
      const was = Math.hypot(
        original[(at + 1) % ring.length][0] - original[at][0],
        original[(at + 1) % ring.length][1] - original[at][1],
      );
      // An edge that was a real length and is now nothing has been squashed,
      // not tidied.
      return was > tolerance && Math.hypot(next[0] - point[0], next[1] - point[1]) < tolerance / 2;
    });

    if (collapsed || (wasArea > 0 && area < wasArea * 0.5)) {
      skipped.push(index);
      return original;
    }
    return ring;
  });

  // --- What is still wrong, said out loud rather than forced ---
  const overlaps: { a: number; b: number; depth: number }[] = [];
  for (let a = 0; a < result.length; a++) {
    for (let b = a + 1; b < result.length; b++) {
      if (result[a].length < 3 || result[b].length < 3) continue;
      const depth = overlapDepth(result[a], result[b]);
      if (depth > tolerance) overlaps.push({ a, b, depth });
    }
  }

  return { rings: result, moved, skipped, overlaps };
}
