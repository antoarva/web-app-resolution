/**
 * Plan to IDF.
 *
 * Each level's footprints are converted to world metres, the levels are stacked
 * by their heights, and the result is handed to the same assembler the built-in
 * templates use — so an imported model carries the identical construction
 * library, schedules, loads and ideal-loads HVAC as `Small Office` or
 * `Warehouse`. The images contribute the shape and nothing else.
 *
 * What the stack adds beyond a single floor is the boundary conditions between
 * storeys: a zone's top is a roof only where nothing sits above it, and its
 * floor is exposed only where nothing sits below.
 */

import {
  type Orientation, type Point2, ORIENTATIONS, orientationName,
} from '@/core/templates/geometry';
import { assemble, type ZoneSpec } from '@/core/templates/buildings';
import {
  ensureCounterClockwise, boundsOfAll, polygonArea, perimeter, pointInPolygon, bounds, minimumGap,
} from './polygon';
import {
  findProgram, levelHeight, levelBaseZ, flipHeightOf,
  type PlanSpec, type PlanLevel, type PlanZone,
} from './types';

/**
 * Two zones separated by more than this cannot be sharing a wall, in metres.
 * Room outlines traced from a drawing sit a wall thickness apart, so the probe
 * has to reach across that gap without joining zones that are genuinely apart.
 */
const MAX_PARTY_WALL_GAP = 1.5;
/** Extra reach past the measured gap, so the probe lands well inside. */
const PROBE_MARGIN = 0.15;
/** Edges shorter than this are corner artefacts, not walls to classify. */
const MIN_EDGE_LENGTH = 0.05;
/** Fractions along an edge to test, so a partial overlap is not miscounted. */
const EDGE_SAMPLES = [0.25, 0.5, 0.75];

export interface WorldZone {
  zone: PlanZone;
  levelId: string;
  /** Footprint in building-frame metres, counterclockwise. */
  footprint: Point2[];
  /** Edge indices facing outdoors; the rest are shared with a neighbour. */
  exteriorEdges: number[];
  area: number;
  windowToWallRatio: number;
  /** Per-side overrides, already resolved from the zone's own settings. */
  windowToWallRatioBySide: Partial<Record<Orientation, number>>;
}

export interface WorldLevel {
  level: PlanLevel;
  index: number;
  baseZ: number;
  height: number;
  repeat: number;
  zones: WorldZone[];
}

/**
 * Image pixels to building metres.
 *
 * Image Y grows downwards and world Y grows north, so the vertical axis is
 * flipped about the image height — about the *image*, not the traced outline,
 * so two floors drawn on the same sheet stay registered even when their
 * footprints differ.
 */
function levelFootprints(level: PlanLevel, fallbackHeight: number): Point2[][] {
  const flip = flipHeightOf(level, fallbackHeight);
  return level.zones.map((zone) => ensureCounterClockwise(
    zone.points.map(([x, y]) => [
      level.offsetX + x * level.metresPerPixelX,
      level.offsetY + (flip - y) * level.metresPerPixelY,
    ] as Point2),
  ));
}

/** Footprints for every level, before the plan is shifted onto the origin. */
function rawFootprints(spec: PlanSpec): Point2[][][] {
  const fallback = spec.levels.find((level) => level.image)?.image?.height ?? 0;
  return spec.levels.map((level) => levelFootprints(level, fallback));
}

/**
 * An edge is a party wall when the space just outside it belongs to another
 * zone on the same level. Probing points offset from the edge rather than
 * matching vertices means two zones traced independently still share a wall,
 * whether their outlines meet exactly or sit a drawn wall thickness apart — the
 * probe distance for each neighbour comes from how far it actually is.
 */
function exteriorEdgesOf(footprint: Point2[], others: Point2[][]): number[] {
  const neighbours = others
    .map((ring) => ({ ring, gap: minimumGap(footprint, ring) }))
    .filter((neighbour) => neighbour.gap <= MAX_PARTY_WALL_GAP);

  const exterior: number[] = [];
  for (let i = 0; i < footprint.length; i++) {
    const [x1, y1] = footprint[i];
    const [x2, y2] = footprint[(i + 1) % footprint.length];
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length < MIN_EDGE_LENGTH) continue;

    // Outward normal of a counterclockwise edge points to its right-hand side.
    const normalX = (y2 - y1) / length;
    const normalY = -(x2 - x1) / length;

    // Samples are counted against every neighbour together, because one long
    // wall can back onto two different zones, each covering only part of it.
    const covered = EDGE_SAMPLES.filter((t) => neighbours.some(({ ring, gap }) => {
      const reach = gap + PROBE_MARGIN;
      return pointInPolygon([
        x1 + (x2 - x1) * t + normalX * reach,
        y1 + (y2 - y1) * t + normalY * reach,
      ], ring);
    })).length;
    if (covered < 2) exterior.push(i);
  }
  return exterior;
}

/** Grid resolution for the coverage samples; 9x9 resolves a tenth of a plate. */
const COVERAGE_STEPS = 9;

/**
 * Points that are certainly inside a ring, for testing what sits above or below
 * it. A centroid is not enough: on an L-shaped or U-shaped floor it can fall in
 * the notch, which would report a covered zone as exposed.
 */
function interiorSamples(ring: Point2[], steps = COVERAGE_STEPS): Point2[] {
  const box = bounds(ring);
  const samples: Point2[] = [];
  for (let iy = 1; iy <= steps; iy++) {
    for (let ix = 1; ix <= steps; ix++) {
      const point: Point2 = [
        box.minX + (box.width * ix) / (steps + 1),
        box.minY + (box.depth * iy) / (steps + 1),
      ];
      if (pointInPolygon(point, ring)) samples.push(point);
    }
  }
  return samples;
}

/**
 * How much of `ring` has one of `others` over or under it, 0 to 1.
 *
 * A zone gets exactly one top surface and one bottom surface, so a plate that
 * is partly under the floor above has to be called one thing or the other.
 * Splitting it would need polygon clipping; instead the majority wins and
 * `validatePlan` warns whenever the split is close enough to matter, because
 * the fix is for the user to trace the podium and the tower footprint as two
 * zones — which the importer already supports.
 */
export function coveredFraction(ring: Point2[], others: Point2[][]): number {
  if (others.length === 0) return 0;
  const samples = interiorSamples(ring);
  if (samples.length === 0) return 0;
  const covered = samples.filter((point) =>
    others.some((other) => pointInPolygon(point, other))).length;
  return covered / samples.length;
}

/** Below this the surface faces the weather; above it, the storey next door. */
const COVERAGE_MAJORITY = 0.5;
/** Outside this band the call is clear-cut and needs no warning. */
const COVERAGE_AMBIGUOUS = [0.12, 0.88] as const;

/** The whole plan in world metres, shifted so its south-west corner is at 0,0. */
export function worldLevels(spec: PlanSpec): WorldLevel[] {
  const perLevel = rawFootprints(spec);
  const box = boundsOfAll(perLevel.flat());
  const shiftX = Number.isFinite(box.minX) ? box.minX : 0;
  const shiftY = Number.isFinite(box.minY) ? box.minY : 0;

  return spec.levels.map((level, index) => {
    const footprints = perLevel[index].map((ring) =>
      ring.map(([x, y]) => [x - shiftX, y - shiftY] as Point2));

    return {
      level,
      index,
      baseZ: levelBaseZ(spec, index),
      height: levelHeight(spec, level),
      repeat: Math.max(1, Math.round(level.repeat)),
      zones: level.zones.map((zone, position) => {
        const footprint = footprints[position];
        return {
          zone,
          levelId: level.id,
          footprint,
          exteriorEdges: exteriorEdgesOf(footprint, footprints.filter((_, other) => other !== position)),
          area: polygonArea(footprint),
          windowToWallRatio: zone.windowToWallRatio ?? spec.windowToWallRatio,
          windowToWallRatioBySide: zone.windowToWallRatioBySide ?? {},
        };
      }),
    };
  });
}

/**
 * Compass side an outward-facing edge looks towards.
 *
 * This is the same rule the assembler names walls by, so a side listed while
 * tracing is the same side the geometry view offers once the model is built.
 */
function edgeOrientation(footprint: Point2[], index: number): Orientation {
  const [x1, y1] = footprint[index];
  const [x2, y2] = footprint[(index + 1) % footprint.length];
  // Outward normal of a counterclockwise edge points to its right-hand side.
  let azimuth = (Math.atan2(y2 - y1, -(x2 - x1)) * 180) / Math.PI;
  if (azimuth < 0) azimuth += 360;
  return orientationName(azimuth);
}

export interface ZoneSide {
  orientation: Orientation;
  /** Gross wall area facing this way, for one storey of this zone. */
  wallArea: number;
  edgeCount: number;
}

/**
 * The compass sides a zone's outward walls face. Sides with no outward wall
 * are left out, so the editor only offers glazing where there is wall to glaze.
 */
export function zoneSidesOf(spec: PlanSpec, zoneId: string): ZoneSide[] {
  for (const entry of worldLevels(spec)) {
    const world = entry.zones.find((candidate) => candidate.zone.id === zoneId);
    if (!world) continue;

    const areas = new Map<Orientation, { wallArea: number; edgeCount: number }>();
    for (const index of world.exteriorEdges) {
      const [x1, y1] = world.footprint[index];
      const [x2, y2] = world.footprint[(index + 1) % world.footprint.length];
      const orientation = edgeOrientation(world.footprint, index);
      const tally = areas.get(orientation) ?? { wallArea: 0, edgeCount: 0 };
      tally.wallArea += Math.hypot(x2 - x1, y2 - y1) * entry.height;
      tally.edgeCount += 1;
      areas.set(orientation, tally);
    }

    return ORIENTATIONS
      .filter((orientation) => areas.has(orientation))
      .map((orientation) => ({ orientation, ...areas.get(orientation)! }));
  }
  return [];
}

/** IDF names cannot carry the delimiters, and must stay unique. */
function safeName(raw: string, taken: Set<string>): string {
  const cleaned = raw.replace(/[,;!]/g, ' ').replace(/\s+/g, '_').replace(/^_+|_+$/g, '');
  const stem = cleaned.length > 0 ? cleaned : 'Zone';
  let candidate = stem;
  let suffix = 2;
  while (taken.has(candidate.toLowerCase())) candidate = `${stem}_${suffix++}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

export function planToZoneSpecs(spec: PlanSpec): ZoneSpec[] {
  const program = findProgram(spec.program);
  const levels = worldLevels(spec);
  const zones: ZoneSpec[] = [];
  const taken = new Set<string>();

  // Storey numbering runs across the whole building, not within a level, so a
  // repeated typical floor still produces L3, L4, L5 rather than three L2s.
  let storeyNumber = 1;

  for (let index = 0; index < levels.length; index++) {
    const entry = levels[index];
    const above = levels[index + 1];
    const below = levels[index - 1];
    const usable = entry.zones.filter((zone) => zone.footprint.length >= 3 && zone.area >= 0.5);

    for (let copy = 0; copy < entry.repeat; copy++) {
      const isTopCopy = copy === entry.repeat - 1;
      const isBottomCopy = copy === 0;
      const baseZ = entry.baseZ + copy * entry.height;

      for (const zone of usable) {
        // Only the top copy of a level can see daylight; below it there is
        // always another identical storey.
        const topIsRoof = isTopCopy
          && coveredFraction(zone.footprint, above?.zones.map((other) => other.footprint) ?? [])
            < COVERAGE_MAJORITY;
        // Likewise only the bottom copy can be left hanging over open air.
        const exposedFloor = isBottomCopy && baseZ > 0.01
          && coveredFraction(zone.footprint, below?.zones.map((other) => other.footprint) ?? [])
            < COVERAGE_MAJORITY;

        zones.push({
          name: safeName(`${zone.zone.name}_L${storeyNumber}`, taken),
          footprint: zone.footprint,
          exteriorEdges: zone.exteriorEdges,
          baseZ,
          height: entry.height,
          windowToWallRatio: zone.exteriorEdges.length > 0 ? zone.windowToWallRatio : 0,
          windowToWallRatioBySide: zone.windowToWallRatioBySide,
          topIsRoof,
          exposedFloor,
          lightingWattsPerArea: program.lightingWattsPerArea,
          equipmentWattsPerArea: program.equipmentWattsPerArea,
          areaPerPerson: program.areaPerPerson,
        });
      }
      storeyNumber++;
    }
  }

  return zones;
}

export function buildPlanIdf(spec: PlanSpec): string {
  const program = findProgram(spec.program);
  return assemble({
    name: spec.name.trim() || 'Traced Plan',
    locationId: spec.locationId,
    zones: planToZoneSpecs(spec),
    northAxis: spec.northAxis,
  }, program.residential);
}

export interface PlanMetrics {
  /** Overall extents of the whole stack, in metres. */
  width: number;
  depth: number;
  footprintArea: number;
  floorArea: number;
  exteriorWallArea: number;
  glazingArea: number;
  buildingHeight: number;
  storeys: number;
  zoneCount: number;
  surfaceCount: number;
}

export function planMetrics(spec: PlanSpec): PlanMetrics {
  const levels = worldLevels(spec);
  const box = boundsOfAll(levels.flatMap((entry) => entry.zones.map((zone) => zone.footprint)));

  let footprintArea = 0;
  let floorArea = 0;
  let exteriorWallArea = 0;
  let glazingArea = 0;
  let buildingHeight = 0;
  let storeys = 0;
  let zoneCount = 0;
  let surfaceCount = 0;

  for (const entry of levels) {
    storeys += entry.repeat;
    buildingHeight += entry.height * entry.repeat;
    // The lowest level's plate is the building's footprint on the ground.
    if (entry.index === 0) {
      footprintArea = entry.zones.reduce((sum, zone) => sum + zone.area, 0);
    }

    for (const zone of entry.zones) {
      if (zone.footprint.length < 3) continue;
      floorArea += zone.area * entry.repeat;
      zoneCount += entry.repeat;

      // Each wall carries its own glazing, so the totals are summed per edge
      // rather than from one ratio over the whole perimeter.
      for (const index of zone.exteriorEdges) {
        const [x1, y1] = zone.footprint[index];
        const [x2, y2] = zone.footprint[(index + 1) % zone.footprint.length];
        const wallArea = Math.hypot(x2 - x1, y2 - y1) * entry.height * entry.repeat;
        exteriorWallArea += wallArea;
        glazingArea += wallArea * (
          zone.windowToWallRatioBySide[edgeOrientation(zone.footprint, index)]
          ?? zone.windowToWallRatio);
      }

      // Walls plus a floor and a ceiling for each storey.
      surfaceCount += (zone.footprint.length + 2) * entry.repeat;
    }
  }

  return {
    width: box.width,
    depth: box.depth,
    footprintArea,
    floorArea,
    exteriorWallArea,
    glazingArea,
    buildingHeight,
    storeys,
    zoneCount,
    surfaceCount,
  };
}

export interface PlanIssue {
  severity: 'error' | 'warning';
  message: string;
  levelId?: string;
}

/** What would stop the plan from generating a model worth running. */
export function validatePlan(spec: PlanSpec): PlanIssue[] {
  const issues: PlanIssue[] = [];
  if (spec.levels.length === 0) {
    issues.push({ severity: 'error', message: 'Add a floor image to start.' });
    return issues;
  }

  const traced = spec.levels.filter((level) => level.zones.length > 0);
  if (traced.length === 0) {
    issues.push({ severity: 'error', message: 'Trace at least one zone outline before creating the model.' });
    return issues;
  }
  for (const level of spec.levels) {
    if (level.zones.length === 0) {
      issues.push({ severity: 'warning', levelId: level.id,
        message: `${level.name} has no zones and will be skipped.` });
    }
  }

  const levels = worldLevels(spec);
  for (const entry of levels) {
    for (const zone of entry.zones) {
      if (zone.footprint.length < 3) {
        issues.push({ severity: 'error', levelId: entry.level.id,
          message: `${zone.zone.name} on ${entry.level.name} needs at least three corners.` });
      } else if (zone.area < 1) {
        issues.push({ severity: 'error', levelId: entry.level.id,
          message: `${zone.zone.name} on ${entry.level.name} is ${zone.area.toFixed(2)} m² — check the scale.` });
      }
    }
  }

  // A floor that lands nowhere near the one below it is almost always a
  // registration problem rather than a real cantilever.
  for (let index = 1; index < levels.length; index++) {
    const entry = levels[index];
    const below = levels[index - 1].zones.map((zone) => zone.footprint);
    if (entry.zones.length === 0 || below.length === 0) continue;
    const floating = entry.zones.filter((zone) =>
      zone.footprint.length >= 3 && coveredFraction(zone.footprint, below) === 0);
    if (floating.length === entry.zones.length) {
      issues.push({ severity: 'warning', levelId: entry.level.id,
        message: `${entry.level.name} does not sit over the floor below. Align it, or check its scale.` });
    }
  }

  // A plate that is only half covered by the floor above gets one surface for
  // the whole top, so say which way the call went and how to make it exact.
  for (let index = 0; index < levels.length - 1; index++) {
    const entry = levels[index];
    const above = levels[index + 1].zones.map((zone) => zone.footprint);
    if (above.length === 0) continue;
    for (const zone of entry.zones) {
      if (zone.footprint.length < 3) continue;
      const coverage = coveredFraction(zone.footprint, above);
      if (coverage <= COVERAGE_AMBIGUOUS[0] || coverage >= COVERAGE_AMBIGUOUS[1]) continue;
      const called = coverage < COVERAGE_MAJORITY ? 'a roof' : 'a ceiling';
      issues.push({ severity: 'warning', levelId: entry.level.id,
        message: `${zone.zone.name} on ${entry.level.name} is ${Math.round(coverage * 100)}% covered by the floor above, so its whole top is modelled as ${called}. Split it into two zones for an exact result.` });
    }
  }

  const metrics = planMetrics(spec);
  if (metrics.width > 500 || metrics.depth > 500) {
    issues.push({ severity: 'warning', message: `The plan is ${metrics.width.toFixed(0)} m by ${metrics.depth.toFixed(0)} m. Recheck the scale if that looks wrong.` });
  }
  if (metrics.floorArea > 0 && metrics.floorArea < 10) {
    issues.push({ severity: 'warning', message: 'The floor area is under 10 m². The scale is probably not set yet.' });
  }
  return issues;
}

// ------------------------------------------------------------ dimension edits

/** Scales every level about the building origin, keeping the stack registered. */
export function scaleBuilding(spec: PlanSpec, factorX: number, factorY: number): PlanSpec {
  if (!Number.isFinite(factorX) || !Number.isFinite(factorY)) return spec;
  return {
    ...spec,
    levels: spec.levels.map((level) => ({
      ...level,
      metresPerPixelX: level.metresPerPixelX * factorX,
      metresPerPixelY: level.metresPerPixelY * factorY,
      offsetX: level.offsetX * factorX,
      offsetY: level.offsetY * factorY,
    })),
  };
}

/**
 * Rescales the plan so the whole stack's extents match `width` and `depth` in
 * metres. This is the primary dimension control: the traced shapes are
 * untouched and only the pixel-to-metre scale moves, so every overlay stays
 * aligned to its own image.
 */
export function scaleToExtents(
  spec: PlanSpec, width: number | null, depth: number | null,
): PlanSpec {
  const current = planMetrics(spec);
  if (current.width <= 0 || current.depth <= 0) return spec;

  let factorX = width && width > 0 ? width / current.width : 1;
  let factorY = depth && depth > 0 ? depth / current.depth : 1;
  if (spec.lockAspect) {
    // Whichever dimension the user just typed drives both axes.
    const driver = width && width > 0 ? factorX : factorY;
    factorX = driver;
    factorY = driver;
  }
  return scaleBuilding(spec, factorX, factorY);
}

/**
 * Applies a measured length to one level only, holding that level's footprint
 * centre still so re-scaling a single floor does not shove it out of the stack.
 */
export function applyLevelScale(
  spec: PlanSpec, levelId: string, metresPerPixel: number,
): PlanSpec {
  const index = spec.levels.findIndex((level) => level.id === levelId);
  if (index === -1 || !(metresPerPixel > 0)) return spec;

  const level = spec.levels[index];
  const fallback = spec.levels.find((entry) => entry.image)?.image?.height ?? 0;
  const before = boundsOfAll(levelFootprints(level, fallback));

  const scaled: PlanLevel = {
    ...level, metresPerPixelX: metresPerPixel, metresPerPixelY: metresPerPixel,
  };
  if (level.zones.length === 0) {
    return { ...spec, levels: spec.levels.map((entry, i) => (i === index ? scaled : entry)) };
  }

  const after = boundsOfAll(levelFootprints(scaled, fallback));
  scaled.offsetX += (before.minX + before.maxX) / 2 - (after.minX + after.maxX) / 2;
  scaled.offsetY += (before.minY + before.maxY) / 2 - (after.minY + after.maxY) / 2;
  return { ...spec, levels: spec.levels.map((entry, i) => (i === index ? scaled : entry)) };
}

/** Shifts one level so its footprint centre sits over the reference level's. */
export function alignLevelTo(spec: PlanSpec, levelId: string, referenceId: string): PlanSpec {
  const level = spec.levels.find((entry) => entry.id === levelId);
  const reference = spec.levels.find((entry) => entry.id === referenceId);
  if (!level || !reference || level.zones.length === 0 || reference.zones.length === 0) return spec;

  const fallback = spec.levels.find((entry) => entry.image)?.image?.height ?? 0;
  const mine = boundsOfAll(levelFootprints(level, fallback));
  const theirs = boundsOfAll(levelFootprints(reference, fallback));

  return {
    ...spec,
    levels: spec.levels.map((entry) => (entry.id === levelId ? {
      ...entry,
      offsetX: entry.offsetX + (theirs.minX + theirs.maxX) / 2 - (mine.minX + mine.maxX) / 2,
      offsetY: entry.offsetY + (theirs.minY + theirs.maxY) / 2 - (mine.minY + mine.maxY) / 2,
    } : entry)),
  };
}

/** Nudges a level in the building frame, in metres. */
export function moveLevel(spec: PlanSpec, levelId: string, dx: number, dy: number): PlanSpec {
  return {
    ...spec,
    levels: spec.levels.map((level) => (level.id === levelId
      ? { ...level, offsetX: level.offsetX + dx, offsetY: level.offsetY + dy }
      : level)),
  };
}

/** Resizes one zone's footprint about its own centroid, in metres. */
export function resizeZone(
  spec: PlanSpec, levelId: string, zoneId: string, width: number | null, depth: number | null,
): PlanSpec {
  const level = spec.levels.find((entry) => entry.id === levelId);
  const zone = level?.zones.find((entry) => entry.id === zoneId);
  if (!level || !zone) return spec;

  const box = bounds(zone.points);
  if (box.width <= 0 || box.depth <= 0) return spec;

  const currentWidth = box.width * level.metresPerPixelX;
  const currentDepth = box.depth * level.metresPerPixelY;
  const scaleX = width && width > 0 ? width / currentWidth : 1;
  const scaleY = depth && depth > 0 ? depth / currentDepth : 1;
  if (scaleX === 1 && scaleY === 1) return spec;

  const originX = (box.minX + box.maxX) / 2;
  const originY = (box.minY + box.maxY) / 2;
  const points = zone.points.map(([x, y]) => [
    originX + (x - originX) * scaleX,
    originY + (y - originY) * scaleY,
  ] as Point2);

  return {
    ...spec,
    levels: spec.levels.map((entry) => (entry.id === levelId ? {
      ...entry,
      zones: entry.zones.map((other) => (other.id === zoneId ? { ...other, points } : other)),
    } : entry)),
  };
}

/** Perimeter of a zone in metres, for the dimension readouts. */
export function zonePerimeter(level: PlanLevel, zone: PlanZone): number {
  const uniform = Math.abs(level.metresPerPixelX - level.metresPerPixelY) < 1e-9;
  if (uniform) return perimeter(zone.points) * level.metresPerPixelX;
  return perimeter(zone.points.map(([x, y]) => [
    x * level.metresPerPixelX, y * level.metresPerPixelY,
  ] as Point2));
}

/**
 * One level's outlines expressed in another level's image pixels.
 *
 * This is what lets the canvas draw the floor below as a ghost under the floor
 * being edited: the rings go up into the shared building frame through the
 * source level's registration and back down through the target's.
 */
export function footprintsInLevelPixels(
  spec: PlanSpec, sourceId: string, targetId: string,
): Point2[][] {
  const source = spec.levels.find((level) => level.id === sourceId);
  const target = spec.levels.find((level) => level.id === targetId);
  if (!source || !target) return [];
  if (target.metresPerPixelX <= 0 || target.metresPerPixelY <= 0) return [];

  const fallback = spec.levels.find((level) => level.image)?.image?.height ?? 0;
  const targetFlip = flipHeightOf(target, fallback);

  return levelFootprints(source, fallback).map((ring) => ring.map(([wx, wy]) => [
    (wx - target.offsetX) / target.metresPerPixelX,
    targetFlip - (wy - target.offsetY) / target.metresPerPixelY,
  ] as Point2));
}
