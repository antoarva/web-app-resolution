/**
 * Whole-building geometry edits.
 *
 * The IDF text stays the single source of truth, so a specification change here
 * is a rewrite of vertex fields, not a second copy of the model held to one
 * side. Every target is absolute rather than a delta: typing the old width back
 * in restores it exactly, which is what makes a panel of live measurements safe
 * to edit over and over.
 *
 * This works on any model the app can open, not only the generated ones, since
 * it reads the geometry it is about to change out of the objects themselves.
 */

import {
  type IdfModel, type IdfObject,
  objectName, numericField, textField, firstOfClass, setField,
} from '@/core/idf/types';
import { getClassSchema } from '@/core/idd/schema';
import {
  type Orientation, ORIENTATIONS, ORIENTATION_LABELS, orientationName,
} from '@/core/templates/geometry';

export type { Orientation };
import type { BuildingModel, Vec3 } from './building';

const SURFACE_CLASS = 'BuildingSurface:Detailed';
const FENESTRATION_CLASS = 'FenestrationSurface:Detailed';
const SHADING_CLASS = 'Shading:Building:Detailed';

/** Vertex tails, by class and by the field index the coordinates start at. */
const VERTEX_CLASSES: { className: string; fallbackStart: number }[] = [
  { className: SURFACE_CLASS, fallbackStart: 11 },
  { className: FENESTRATION_CLASS, fallbackStart: 9 },
  { className: SHADING_CLASS, fallbackStart: 3 },
];

/** Zone fields that describe a size, with the exponent each scale applies at. */
const ZONE_SIZE_FIELDS: { index: number; x: number; y: number; z: number }[] = [
  { index: 7, x: 0, y: 0, z: 1 }, // Ceiling Height
  { index: 8, x: 1, y: 1, z: 1 }, // Volume
  { index: 9, x: 1, y: 1, z: 0 }, // Floor Area
];

/** Clear space left between a resized window and the edge of its wall. */
const JAMB_MARGIN = 0.1;
/** Two storeys count as evenly stacked when their heights agree to this. */
const LEVEL_TOLERANCE = 0.05;
/** Windows may shrink to this share of their current size, but no further. */
const MIN_WINDOW_SCALE = 0.05;

export type GlazingScope =
  | { kind: 'building' }
  | { kind: 'side'; orientation: Orientation }
  | { kind: 'zone'; zone: string }
  /** One zone's walls facing one way: the finest grain the panel offers. */
  | { kind: 'zone-side'; zone: string; orientation: Orientation };

/** Glazing measured over one part of the envelope. */
export interface GlazingGroup {
  scope: GlazingScope;
  label: string;
  /** Gross exterior wall area, before any opening is subtracted. */
  wallArea: number;
  windowArea: number;
  windowToWallRatio: number;
  windowCount: number;
  /**
   * The same walls split the other way: a side's zones, or a zone's sides.
   * Both breakdowns end at the same zone-and-side leaves.
   */
  children?: GlazingGroup[];
}

export interface GlazingChange {
  scope: GlazingScope;
  ratio: number;
}

/** The specifications the geometry view exposes for editing. */
export interface GeometrySpec {
  /** Overall extents of the model, in metres. */
  width: number;
  depth: number;
  height: number;
  /** Lowest point of the model; the height scale is anchored here. */
  baseZ: number;
  storeys: number;
  /** Height of one storey, or null when the storeys are not evenly stacked. */
  storeyHeight: number | null;
  /**
   * Glazing as a share of gross exterior wall area: the whole envelope, then
   * the same ratio one compass side and one zone at a time.
   */
  glazing: { building: GlazingGroup; sides: GlazingGroup[]; zones: GlazingGroup[] };
  northAxis: number;
  floorArea: number;
  volume: number;
  zoneCount: number;
}

export interface GeometryEdit {
  width?: number;
  depth?: number;
  height?: number;
  /** Glazing targets, each over its own part of the envelope. */
  glazing?: GlazingChange[];
  northAxis?: number;
}

export interface GeometryEditResult {
  objects: IdfObject[];
  /** Anything the model would not do exactly as asked, in plain words. */
  notes: string[];
  changed: boolean;
}

// ------------------------------------------------------------------ measuring

/** Distinct floor levels, lowest first, as the base Z of each zone. */
function levelsOf(building: BuildingModel): number[] {
  const levels = new Set<number>();
  for (const zone of building.zones) {
    let base = Infinity;
    for (const surface of zone.surfaces) base = Math.min(base, surface.minZ);
    if (Number.isFinite(base)) levels.add(Math.round(base * 100) / 100);
  }
  return [...levels].sort((a, b) => a - b);
}

/** One outward-facing wall, with whatever glazing sits on it. */
interface ExteriorWall {
  /** Lower-cased, since windows name their host in whatever case they like. */
  name: string;
  zone: string;
  orientation: Orientation;
  /** Gross area: an IDF wall keeps its whole polygon under its windows. */
  area: number;
  windowArea: number;
  windowCount: number;
}

/**
 * Every wall that faces outdoors, with its glazing totalled onto it. This is
 * the one pass both the panel's readings and the glazing edits work from, so a
 * ratio shown and a ratio applied can never be measured differently.
 */
function surveyWalls(objects: IdfObject[]): ExteriorWall[] {
  const surfaceStart = vertexStart(SURFACE_CLASS, 11);
  const windowStart = vertexStart(FENESTRATION_CLASS, 9);
  const byName = new Map<string, ExteriorWall>();

  for (const object of objects) {
    if (object.className !== SURFACE_CLASS) continue;
    if (textField(object, 1, 'Wall').toLowerCase() !== 'wall') continue;
    if (textField(object, 5, 'Outdoors').toLowerCase() !== 'outdoors') continue;

    const vertices = readVertices(object, surfaceStart);
    if (vertices.length < 3) continue;
    const normal = newellNormal(vertices);
    if (!normal) continue;

    byName.set(objectName(object).toLowerCase(), {
      name: objectName(object).toLowerCase(),
      zone: textField(object, 3, ''),
      orientation: orientationName(azimuthOf(normal)) as Orientation,
      area: polygonArea(vertices),
      windowArea: 0,
      windowCount: 0,
    });
  }

  for (const object of objects) {
    if (object.className !== FENESTRATION_CLASS) continue;
    const wall = byName.get(textField(object, 3, '').toLowerCase());
    if (!wall) continue;
    const vertices = readVertices(object, windowStart);
    if (vertices.length < 3) continue;
    // A multiplied window stands for several of itself.
    wall.windowArea += polygonArea(vertices) * Math.max(1, numericField(object, 7, 1));
    wall.windowCount += 1;
  }

  return [...byName.values()];
}

function groupOf(scope: GlazingScope, label: string, walls: ExteriorWall[]): GlazingGroup {
  let wallArea = 0;
  let windowArea = 0;
  let windowCount = 0;
  for (const wall of walls) {
    wallArea += wall.area;
    windowArea += wall.windowArea;
    windowCount += wall.windowCount;
  }
  return {
    scope, label, wallArea, windowArea, windowCount,
    windowToWallRatio: wallArea > 0 ? windowArea / wallArea : 0,
  };
}

/** The walls a glazing target applies to. */
function wallsInScope(walls: ExteriorWall[], scope: GlazingScope): ExteriorWall[] {
  if (scope.kind === 'building') return walls;
  if (scope.kind === 'side') return walls.filter((wall) => wall.orientation === scope.orientation);
  const zone = scope.zone.toLowerCase();
  if (scope.kind === 'zone') return walls.filter((wall) => wall.zone.toLowerCase() === zone);
  return walls.filter((wall) =>
    wall.zone.toLowerCase() === zone && wall.orientation === scope.orientation);
}

/** Zone names in the order their walls first appear, matched case-insensitively. */
function zoneNamesOf(walls: ExteriorWall[]): string[] {
  const names: string[] = [];
  for (const wall of walls) {
    if (!names.some((name) => name.toLowerCase() === wall.zone.toLowerCase())) names.push(wall.zone);
  }
  return names;
}

const inZone = (wall: ExteriorWall, zone: string): boolean =>
  wall.zone.toLowerCase() === zone.toLowerCase();

/**
 * Glazing broken down whole, by compass side, and by zone — each of the latter
 * two carrying the other as its children, so either route reaches the same
 * zone-and-side walls.
 */
export function glazingGroups(objects: IdfObject[]): {
  building: GlazingGroup; sides: GlazingGroup[]; zones: GlazingGroup[];
} {
  const walls = surveyWalls(objects);

  const sides: GlazingGroup[] = [];
  for (const orientation of ORIENTATIONS) {
    const facing = walls.filter((wall) => wall.orientation === orientation);
    if (facing.length === 0) continue;
    const group = groupOf({ kind: 'side', orientation }, ORIENTATION_LABELS[orientation], facing);
    // A side splits into the zones behind it, each labelled by that zone.
    group.children = zoneNamesOf(facing).map((zone) => groupOf(
      { kind: 'zone-side', zone, orientation }, zone,
      facing.filter((wall) => inZone(wall, zone)),
    ));
    sides.push(group);
  }

  // Zones keep the order they appear in the file, which is the order the rest
  // of the app lists them in.
  const zones = zoneNamesOf(walls).map((zone) => {
    const own = walls.filter((wall) => inZone(wall, zone));
    const group = groupOf({ kind: 'zone', zone }, zone, own);
    // And a zone splits into the ways its walls face.
    group.children = ORIENTATIONS
      .filter((orientation) => own.some((wall) => wall.orientation === orientation))
      .map((orientation) => groupOf(
        { kind: 'zone-side', zone, orientation }, ORIENTATION_LABELS[orientation],
        own.filter((wall) => wall.orientation === orientation),
      ));
    return group;
  });

  return { building: groupOf({ kind: 'building' }, 'Whole building', walls), sides, zones };
}

export function measureGeometry(model: IdfModel, building: BuildingModel): GeometrySpec {
  const [width, depth, height] = building.bounds.size;
  const glazing = glazingGroups(model.objects);
  const levels = levelsOf(building);
  const storeys = Math.max(1, levels.length);

  // Even stacking is judged on the gaps between levels plus the last one up to
  // the roof, so a single storey and a clean stack both come out even.
  const gaps: number[] = [];
  for (let i = 1; i < levels.length; i++) gaps.push(levels[i] - levels[i - 1]);
  gaps.push(building.bounds.max[2] - (levels[levels.length - 1] ?? building.bounds.min[2]));
  const even = gaps.every((gap) => Math.abs(gap - gaps[0]) <= LEVEL_TOLERANCE);

  return {
    width,
    depth,
    height,
    baseZ: building.bounds.min[2],
    storeys,
    storeyHeight: even && storeys > 0 ? height / storeys : null,
    glazing,
    northAxis: building.northAxis,
    floorArea: building.totals.floorArea,
    volume: building.totals.volume,
    zoneCount: building.zones.length,
  };
}

// ------------------------------------------------------------- vertex helpers

function vertexStart(className: string, fallback: number): number {
  return getClassSchema(className)?.extensible?.startIndex ?? fallback;
}

/** Reads the vertex tail exactly as the model builder does, in field order. */
function readVertices(object: IdfObject, start: number): Vec3[] {
  const vertices: Vec3[] = [];
  for (let i = start; i + 2 < object.fields.length; i += 3) {
    const x = numericField(object, i, NaN);
    const y = numericField(object, i + 1, NaN);
    const z = numericField(object, i + 2, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) break;
    vertices.push([x, y, z]);
  }
  return vertices;
}

function round(value: number): string {
  const snapped = Math.round(value * 1000) / 1000;
  // -0 serialises as "-0", which is noise in a diff.
  return String(snapped === 0 ? 0 : snapped);
}

function writeVertices(object: IdfObject, start: number, vertices: Vec3[]): IdfObject {
  let next = object;
  vertices.forEach((vertex, index) => {
    const base = start + index * 3;
    next = setField(next, base, round(vertex[0]));
    next = setField(next, base + 1, round(vertex[1]));
    next = setField(next, base + 2, round(vertex[2]));
  });
  return next;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalise(v: Vec3): Vec3 | null {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length < 1e-9) return null;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function centroidOf(vertices: Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const vertex of vertices) {
    x += vertex[0];
    y += vertex[1];
    z += vertex[2];
  }
  const count = vertices.length || 1;
  return [x / count, y / count, z / count];
}

/** Newell's method, which tolerates the slight non-planarity real files carry. */
function newellVector(polygon: Vec3[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

function newellNormal(polygon: Vec3[]): Vec3 | null {
  return normalise(newellVector(polygon));
}

/** The vector's length is twice the polygon's area, however it is oriented. */
function polygonArea(polygon: Vec3[]): number {
  const vector = newellVector(polygon);
  return Math.hypot(vector[0], vector[1], vector[2]) / 2;
}

/** Compass bearing of an outward normal, in degrees clockwise from north. */
function azimuthOf(normal: Vec3): number {
  const degrees = (Math.atan2(normal[0], normal[1]) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

interface PlaneBasis {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
}

/** A 2D frame lying in a polygon's own plane, for measuring fit inside it. */
function planeBasis(polygon: Vec3[]): PlaneBasis | null {
  const normal = newellNormal(polygon);
  if (!normal) return null;
  for (let i = 0; i < polygon.length; i++) {
    const edge = normalise(subtract(polygon[(i + 1) % polygon.length], polygon[i]));
    if (!edge) continue;
    const v = normalise(cross(normal, edge));
    if (!v) continue;
    return { origin: polygon[0], u: edge, v };
  }
  return null;
}

function project(point: Vec3, basis: PlaneBasis): [number, number] {
  const local = subtract(point, basis.origin);
  return [dot(local, basis.u), dot(local, basis.v)];
}

// --------------------------------------------------------------------- edits

function scaleAbout(point: Vec3, anchor: Vec3, factors: Vec3): Vec3 {
  return [
    anchor[0] + (point[0] - anchor[0]) * factors[0],
    anchor[1] + (point[1] - anchor[1]) * factors[1],
    anchor[2] + (point[2] - anchor[2]) * factors[2],
  ];
}

/**
 * Scales every polygon in the model.
 *
 * With relative coordinates the world position of a vertex is its zone origin
 * plus its own value, so the origins move with the anchor while the vertices
 * themselves scale about zero. Doing both is what keeps the two halves of the
 * sum consistent.
 */
function scaleGeometry(
  objects: IdfObject[], factors: Vec3, anchor: Vec3, relative: boolean,
): IdfObject[] {
  const zero: Vec3 = [0, 0, 0];
  return objects.map((object) => {
    if (object.className === 'Zone') {
      const origin: Vec3 = [
        numericField(object, 2, 0), numericField(object, 3, 0), numericField(object, 4, 0),
      ];
      let next = object;
      if (relative) {
        const moved = scaleAbout(origin, anchor, factors);
        next = setField(next, 2, round(moved[0]));
        next = setField(next, 3, round(moved[1]));
        next = setField(next, 4, round(moved[2]));
      }
      // Sizes stated on the zone are only honoured when given as numbers;
      // autocalculate is far more common and needs no help.
      for (const field of ZONE_SIZE_FIELDS) {
        const raw = (next.fields[field.index] ?? '').trim();
        if (raw === '') continue;
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;
        const scale = factors[0] ** field.x * factors[1] ** field.y * factors[2] ** field.z;
        next = setField(next, field.index, round(value * scale));
      }
      return next;
    }

    const entry = VERTEX_CLASSES.find((candidate) => candidate.className === object.className);
    if (!entry) return object;

    const start = vertexStart(entry.className, entry.fallbackStart);
    const vertices = readVertices(object, start);
    if (vertices.length === 0) return object;

    // Shading is always in world coordinates, whatever the rules say.
    const useAnchor = relative && object.className !== SHADING_CLASS ? zero : anchor;
    return writeVertices(object, start, vertices.map((v) => scaleAbout(v, useAnchor, factors)));
  });
}

/** Frame with u running horizontally along a wall and v up its slope. */
function wallBasis(polygon: Vec3[]): PlaneBasis | null {
  const normal = newellNormal(polygon);
  if (normal) {
    const horizontal = normalise(cross([0, 0, 1], normal));
    const up = horizontal ? normalise(cross(normal, horizontal)) : null;
    if (horizontal && up) return { origin: polygon[0], u: horizontal, v: up };
  }
  // A horizontal surface has no "up" in its own plane; any frame will do.
  return planeBasis(polygon);
}

interface FitLimits {
  basis: PlaneBasis;
  /** How far the window may grow along the wall, and up it. */
  u: number;
  v: number;
}

/**
 * How much room a window has left inside its host wall, measured separately
 * along each axis of the wall's own plane. Sloped and rotated walls work the
 * same way, since the frame comes from the wall rather than from the world.
 */
function fitLimits(window: Vec3[], host: Vec3[]): FitLimits | null {
  const basis = wallBasis(host);
  if (!basis) return null;

  const min: [number, number] = [Infinity, Infinity];
  const max: [number, number] = [-Infinity, -Infinity];
  for (const point of host.map((vertex) => project(vertex, basis))) {
    for (const axis of [0, 1] as const) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }

  const centre = project(centroidOf(window), basis);
  const limits: [number, number] = [Infinity, Infinity];
  for (const vertex of window) {
    const point = project(vertex, basis);
    for (const axis of [0, 1] as const) {
      const span = max[axis] - min[axis];
      // A margin wider than the wall itself would forbid any window at all.
      const margin = Math.min(JAMB_MARGIN, span * 0.2);
      const offset = point[axis] - centre[axis];
      if (Math.abs(offset) < 1e-9) continue;
      const bound = offset > 0 ? max[axis] - margin : min[axis] + margin;
      limits[axis] = Math.min(limits[axis], (bound - centre[axis]) / offset);
    }
  }
  return { basis, u: limits[0], v: limits[1] };
}

/** Scales a planar ring about a point, by a different factor on each axis. */
function scaleInPlane(
  vertices: Vec3[], centre: Vec3, basis: PlaneBasis, alongWall: number, upWall: number,
): Vec3[] {
  return vertices.map((vertex) => {
    const offset = subtract(vertex, centre);
    const u = dot(offset, basis.u) * (alongWall - 1);
    const v = dot(offset, basis.v) * (upWall - 1);
    return [
      vertex[0] + basis.u[0] * u + basis.v[0] * v,
      vertex[1] + basis.u[1] * u + basis.v[1] * v,
      vertex[2] + basis.u[2] * u + basis.v[2] * v,
    ] as Vec3;
  });
}

/**
 * Resizes every window about its own centre, so sill heights and positions
 * along the wall stay in proportion instead of being redrawn.
 *
 * `factor` is a length scale, but the target is an area. When one axis runs out
 * of wall — a low sill stops a window growing downwards long before its jambs
 * reach the corners — the other takes up the slack, so the glazing target is
 * still met and only the shape of the opening gives way.
 */
function resizeWindows(
  objects: IdfObject[], factor: number, hostNames: Set<string>,
): { objects: IdfObject[]; clamped: number } {
  const surfaceStart = vertexStart(SURFACE_CLASS, 11);
  const windowStart = vertexStart(FENESTRATION_CLASS, 9);

  const hosts = new Map<string, Vec3[]>();
  for (const object of objects) {
    if (object.className !== SURFACE_CLASS) continue;
    hosts.set(objectName(object).toLowerCase(), readVertices(object, surfaceStart));
  }

  const targetArea = factor * factor;
  let clamped = 0;

  const next = objects.map((object) => {
    if (object.className !== FENESTRATION_CLASS) return object;
    const hostName = textField(object, 3, '').toLowerCase();
    if (!hostNames.has(hostName)) return object;
    const vertices = readVertices(object, windowStart);
    if (vertices.length < 3) return object;

    const host = hosts.get(hostName);
    const limits = factor > 1 && host && host.length >= 3 ? fitLimits(vertices, host) : null;

    // Shrinking always fits; only growth can run off the end of a wall.
    let alongWall = Math.max(factor, MIN_WINDOW_SCALE);
    let upWall = alongWall;
    if (limits) {
      if (factor > limits.v) {
        upWall = Math.max(1, limits.v);
        alongWall = Math.min(Math.max(1, limits.u), targetArea / upWall);
      } else if (factor > limits.u) {
        alongWall = Math.max(1, limits.u);
        upWall = Math.min(Math.max(1, limits.v), targetArea / alongWall);
      }
      if (alongWall * upWall < targetArea - 1e-6) clamped++;
    }

    const centre = centroidOf(vertices);
    const basis = limits?.basis ?? wallBasis(host ?? vertices) ?? planeBasis(vertices);
    if (!basis) return object;
    return writeVertices(object, windowStart, scaleInPlane(vertices, centre, basis, alongWall, upWall));
  });

  return { objects: next, clamped };
}

function labelOf(scope: GlazingScope, walls: ExteriorWall[]): string {
  const side = (orientation: Orientation): string => ORIENTATION_LABELS[orientation].toLowerCase();
  if (scope.kind === 'building') return 'This model';
  if (scope.kind === 'side') return `The ${side(scope.orientation)} side`;
  const zone = walls[0]?.zone ?? scope.zone;
  if (scope.kind === 'zone') return zone;
  return `The ${side(scope.orientation)} side of ${zone}`;
}

/** Where a note's windows are, phrased to sit inside a sentence. */
function whereOf(scope: GlazingScope, label: string): string {
  const side = (orientation: Orientation): string => ORIENTATION_LABELS[orientation].toLowerCase();
  if (scope.kind === 'building') return '';
  if (scope.kind === 'side') return ` on the ${side(scope.orientation)} side`;
  if (scope.kind === 'zone') return ` in ${label}`;
  return ` on the ${side(scope.orientation)} side of ${scope.zone}`;
}

/** A scale factor for a target, or 1 when the target is missing or unusable. */
function factorFor(target: number | undefined, current: number): number {
  if (target === undefined || !Number.isFinite(target) || target <= 0) return 1;
  if (!Number.isFinite(current) || current <= 1e-6) return 1;
  const factor = target / current;
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/**
 * Applies a specification change and hands back the new object list, leaving
 * the caller to re-serialise. Anything the model could not do exactly comes
 * back in `notes` rather than being silently rounded away.
 */
export function applyGeometryEdit(
  model: IdfModel, building: BuildingModel, edit: GeometryEdit,
): GeometryEditResult {
  const spec = measureGeometry(model, building);
  const notes: string[] = [];
  let objects = model.objects;
  let changed = false;

  const factors: Vec3 = [
    factorFor(edit.width, spec.width),
    factorFor(edit.depth, spec.depth),
    factorFor(edit.height, spec.height),
  ];
  const scaling = factors.some((factor) => Math.abs(factor - 1) > 1e-6);
  if (scaling) {
    const rules = firstOfClass(model, 'GlobalGeometryRules');
    const relative = rules !== undefined
      && textField(rules, 2, 'Relative').toLowerCase() !== 'world';
    const anchor: Vec3 = [
      building.bounds.min[0], building.bounds.min[1], building.bounds.min[2],
    ];
    objects = scaleGeometry(objects, factors, anchor, relative);
    changed = true;
  }

  // Each target is measured afresh, so several of them in one edit compose
  // instead of fighting over the same windows.
  for (const change of edit.glazing ?? []) {
    const target = Math.max(0, change.ratio);
    if (!Number.isFinite(target)) continue;

    const walls = wallsInScope(surveyWalls(objects), change.scope);
    const group = groupOf(change.scope, labelOf(change.scope, walls), walls);
    if (group.windowCount === 0) {
      notes.push(`${group.label} has no windows to resize, so its glazing was left alone.`);
      continue;
    }
    if (Math.abs(target - group.windowToWallRatio) <= 1e-4) continue;

    // Area scales with the square of a length, so the side scale is the root.
    const hostNames = new Set(walls.map((wall) => wall.name));
    const result = resizeWindows(objects, Math.sqrt(target / group.windowToWallRatio), hostNames);
    objects = result.objects;
    changed = true;
    if (result.clamped > 0) {
      notes.push(
        `${result.clamped} window${result.clamped === 1 ? '' : 's'}${whereOf(change.scope, group.label)} `
        + 'stopped short of the target: any larger and they would not fit their walls.',
      );
    }
  }

  if (edit.northAxis !== undefined && Number.isFinite(edit.northAxis)) {
    const normalised = ((edit.northAxis % 360) + 360) % 360;
    if (Math.abs(normalised - spec.northAxis) > 1e-6) {
      const buildingObject = firstOfClass({ objects }, 'Building');
      if (!buildingObject) {
        notes.push('This model has no Building object, so the orientation was left alone.');
      } else {
        objects = objects.map((object) => (object.id === buildingObject.id
          ? setField(object, 1, round(normalised))
          : object));
        changed = true;
      }
    }
  }

  return { objects, notes, changed };
}
