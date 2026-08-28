/**
 * Polygon maths for the image-traced plans.
 *
 * Everything here works on simple closed rings given as an ordered vertex list
 * with no repeated final point, matching the footprints the IDF generators in
 * `core/templates/geometry` expect.
 */

import type { Point2 } from '@/core/templates/geometry';

export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  depth: number;
}

/** Positive when the ring is counterclockwise in a Y-up frame. */
export function signedArea(points: Point2[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    total += x1 * y2 - x2 * y1;
  }
  return total / 2;
}

export function polygonArea(points: Point2[]): number {
  return Math.abs(signedArea(points));
}

/**
 * The IDF surface generator derives outward normals from the walk direction,
 * so every footprint must be counterclockwise before it is handed over.
 */
export function ensureCounterClockwise(points: Point2[]): Point2[] {
  return signedArea(points) < 0 ? points.slice().reverse() : points.slice();
}

export function centroid(points: Point2[]): Point2 {
  const area = signedArea(points);
  // A degenerate ring has no area to weight by; fall back to the vertex mean.
  if (Math.abs(area) < 1e-9) {
    const sum = points.reduce<Point2>((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
    return [sum[0] / points.length, sum[1] / points.length];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (6 * area), cy / (6 * area)];
}

export function bounds(points: Point2[]): Bounds2 {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, depth: 0 };
  return { minX, minY, maxX, maxY, width: maxX - minX, depth: maxY - minY };
}

/** Bounds across several rings, used for the whole-plan extents. */
export function boundsOfAll(rings: Point2[][]): Bounds2 {
  return bounds(rings.flat());
}

export function scaleAbout(points: Point2[], origin: Point2, scaleX: number, scaleY: number): Point2[] {
  return points.map(([x, y]) => [
    origin[0] + (x - origin[0]) * scaleX,
    origin[1] + (y - origin[1]) * scaleY,
  ] as Point2);
}

export function translate(points: Point2[], dx: number, dy: number): Point2[] {
  return points.map(([x, y]) => [x + dx, y + dy] as Point2);
}

export function perimeter(points: Point2[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    total += Math.hypot(x2 - x1, y2 - y1);
  }
  return total;
}

/** Ray casting; points exactly on an edge may fall either way. */
export function pointInPolygon([px, py]: Point2, polygon: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const straddles = yi > py !== yj > py;
    if (straddles && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(point: Point2, start: Point2, end: Point2): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  let t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

/**
 * Closest approach between two rings' boundaries. Zero when they touch or
 * overlap, so it doubles as an adjacency test.
 */
export function minimumGap(a: Point2[], b: Point2[]): number {
  let best = Infinity;
  const scan = (points: Point2[], ring: Point2[]): void => {
    for (const point of points) {
      for (let i = 0; i < ring.length; i++) {
        const distance = distanceToSegment(point, ring[i], ring[(i + 1) % ring.length]);
        if (distance < best) best = distance;
      }
    }
  };
  scan(a, b);
  scan(b, a);
  return best;
}

/** Drops vertices closer together than `epsilon`, including across the wrap. */
export function dedupe(points: Point2[], epsilon = 1e-6): Point2[] {
  const kept: Point2[] = [];
  for (const point of points) {
    const previous = kept[kept.length - 1];
    if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) <= epsilon) continue;
    kept.push(point);
  }
  while (kept.length > 1) {
    const first = kept[0];
    const last = kept[kept.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) > epsilon) break;
    kept.pop();
  }
  return kept;
}

/** Ramer-Douglas-Peucker on an open run of points. */
function simplifyRun(points: Point2[], tolerance: number): Point2[] {
  if (points.length < 3) return points.slice();

  let worst = 0;
  let worstIndex = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const distance = distanceToSegment(points[i], points[0], points[points.length - 1]);
    if (distance > worst) {
      worst = distance;
      worstIndex = i;
    }
  }
  if (worst <= tolerance) return [points[0], points[points.length - 1]];

  const left = simplifyRun(points.slice(0, worstIndex + 1), tolerance);
  const right = simplifyRun(points.slice(worstIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

/**
 * Simplifies a closed ring. The ring is cut at the vertex furthest from the
 * centroid so the split point is a real corner rather than an arbitrary one,
 * which keeps building corners from being smoothed away.
 */
export function simplifyRing(points: Point2[], tolerance: number): Point2[] {
  const ring = dedupe(points);
  if (ring.length < 4 || tolerance <= 0) return ring;

  const middle = centroid(ring);
  let anchor = 0;
  let furthest = -1;
  ring.forEach(([x, y], index) => {
    const distance = Math.hypot(x - middle[0], y - middle[1]);
    if (distance > furthest) {
      furthest = distance;
      anchor = index;
    }
  });

  const rotated = [...ring.slice(anchor), ...ring.slice(0, anchor)];
  const open = [...rotated, rotated[0]];
  const simplified = simplifyRun(open, tolerance);
  return dedupe(simplified.slice(0, -1));
}

/** Length-weighted dominant edge direction, folded into 0-90 degrees. */
export function dominantAngle(points: Point2[]): number {
  let sumSin = 0;
  let sumCos = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length < 1e-9) continue;
    // Edges 90 degrees apart are equivalent for a rectilinear plan, so the
    // angle is quadrupled before averaging and quartered again afterwards.
    const angle = Math.atan2(y2 - y1, x2 - x1) * 4;
    sumSin += Math.sin(angle) * length;
    sumCos += Math.cos(angle) * length;
  }
  if (sumSin === 0 && sumCos === 0) return 0;
  const mean = Math.atan2(sumSin, sumCos) / 4;
  return ((mean * 180) / Math.PI + 360) % 90;
}

function rotate(points: Point2[], radians: number, origin: Point2): Point2[] {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map(([x, y]) => {
    const dx = x - origin[0];
    const dy = y - origin[1];
    return [origin[0] + dx * cos - dy * sin, origin[1] + dx * sin + dy * cos] as Point2;
  });
}

/**
 * Squares a traced ring up: edges within `toleranceDeg` of the plan's dominant
 * axis are forced parallel to it, which turns a jagged raster outline into the
 * kind of rectilinear footprint a reference model wants. Returns the input
 * unchanged when squaring would distort the shape by more than a tenth of its
 * area, which is the signal that the plan simply is not rectilinear.
 */
export function orthogonalize(points: Point2[], toleranceDeg = 22): Point2[] {
  const ring = dedupe(points);
  if (ring.length < 4) return ring;

  const origin = centroid(ring);
  const angle = (dominantAngle(ring) * Math.PI) / 180;
  const local = rotate(ring, -angle, origin);

  // Classify each edge as horizontal or vertical, then force the shared
  // coordinate of its endpoints to their average so the edge becomes axis
  // aligned. Two passes settle the corners where a run of edges meets.
  const xs = local.map((point) => point[0]);
  const ys = local.map((point) => point[1]);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < local.length; i++) {
      const j = (i + 1) % local.length;
      const dx = xs[j] - xs[i];
      const dy = ys[j] - ys[i];
      const length = Math.hypot(dx, dy);
      if (length < 1e-9) continue;
      const edgeAngle = (Math.abs((Math.atan2(dy, dx) * 180) / Math.PI) + 180) % 180;
      const offHorizontal = Math.min(edgeAngle, 180 - edgeAngle);
      const offVertical = Math.abs(edgeAngle - 90);
      if (offHorizontal <= toleranceDeg && offHorizontal <= offVertical) {
        const mean = (ys[i] + ys[j]) / 2;
        ys[i] = mean;
        ys[j] = mean;
      } else if (offVertical <= toleranceDeg) {
        const mean = (xs[i] + xs[j]) / 2;
        xs[i] = mean;
        xs[j] = mean;
      }
    }
  }

  const squared = dedupe(rotate(local.map((_, i) => [xs[i], ys[i]] as Point2), angle, origin));
  if (squared.length < 3) return ring;

  const before = polygonArea(ring);
  const after = polygonArea(squared);
  if (before > 0 && Math.abs(after - before) / before > 0.1) return ring;
  return squared;
}
