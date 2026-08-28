/**
 * The editable description of a building traced from images.
 *
 * A plan is a stack of levels, each with its own image — the drawing for that
 * floor — and its own footprints. Footprints are kept in *image pixel*
 * coordinates, never metres. Each level carries the scale and the offset that
 * place its image into the shared building frame, so changing a dimension moves
 * a couple of numbers rather than rewriting every vertex, and the outlines stay
 * registered to the drawings underneath them.
 */

import type { Point2 } from '@/core/templates/geometry';

export type ProgramId = 'office' | 'residential' | 'retail' | 'warehouse' | 'school';

export interface ProgramPreset {
  id: ProgramId;
  label: string;
  /** Drives which schedule set the generated model uses. */
  residential: boolean;
  storeyHeight: number;
  windowToWallRatio: number;
  lightingWattsPerArea: number;
  equipmentWattsPerArea: number;
  areaPerPerson: number;
}

export const PROGRAMS: ProgramPreset[] = [
  { id: 'office', label: 'Office', residential: false, storeyHeight: 3.05,
    windowToWallRatio: 0.33, lightingWattsPerArea: 9.5, equipmentWattsPerArea: 8.5, areaPerPerson: 16 },
  { id: 'residential', label: 'Residential', residential: true, storeyHeight: 2.9,
    windowToWallRatio: 0.25, lightingWattsPerArea: 5.0, equipmentWattsPerArea: 6.0, areaPerPerson: 32 },
  { id: 'retail', label: 'Retail', residential: false, storeyHeight: 4.0,
    windowToWallRatio: 0.4, lightingWattsPerArea: 12.0, equipmentWattsPerArea: 5.0, areaPerPerson: 12 },
  { id: 'warehouse', label: 'Warehouse', residential: false, storeyHeight: 7.0,
    windowToWallRatio: 0.05, lightingWattsPerArea: 6.0, equipmentWattsPerArea: 2.0, areaPerPerson: 200 },
  { id: 'school', label: 'School', residential: false, storeyHeight: 3.4,
    windowToWallRatio: 0.35, lightingWattsPerArea: 10.5, equipmentWattsPerArea: 5.0, areaPerPerson: 3.5 },
];

export function findProgram(id: ProgramId): ProgramPreset {
  return PROGRAMS.find((program) => program.id === id) ?? PROGRAMS[0];
}

export interface ImageSource {
  /** Data URL, so the plan survives a reload without a file handle. */
  src: string;
  name: string;
  width: number;
  height: number;
}

/** The line the user drew over a known dimension, kept so it can be re-edited. */
export interface Calibration {
  start: Point2;
  end: Point2;
  lengthMetres: number;
}

export interface PlanZone {
  id: string;
  name: string;
  /** Closed ring in this level's image pixel coordinates, no repeated vertex. */
  points: Point2[];
  /** Glazing override, 0-1; null follows the plan. */
  windowToWallRatio: number | null;
  /** Stable hue for the overlay and the zone list. */
  hue: number;
}

export interface PlanLevel {
  id: string;
  name: string;
  /** The drawing for this floor. Null on a level duplicated without one. */
  image: ImageSource | null;
  zones: PlanZone[];
  /** Metres per pixel of this level's own image. */
  metresPerPixelX: number;
  metresPerPixelY: number;
  /**
   * Where this level's image origin lands in the building frame, in metres.
   * This is what registers one floor's drawing over another's.
   */
  offsetX: number;
  offsetY: number;
  /** Floor-to-floor height in metres; null follows the plan default. */
  heightOverride: number | null;
  /** Identical storeys this level stands for, for a run of typical floors. */
  repeat: number;
  calibration: Calibration | null;
}

export interface PlanSpec {
  name: string;
  locationId: string;
  program: ProgramId;
  /** Default floor-to-floor height, used by levels without an override. */
  storeyHeight: number;
  /** Building rotation relative to true north, in degrees. */
  northAxis: number;
  windowToWallRatio: number;
  /** Keeps the two axis scales tied together when either is edited. */
  lockAspect: boolean;
  /** Lowest floor first. */
  levels: PlanLevel[];
}

/** Height a level occupies, honouring its override and how often it repeats. */
export function levelHeight(spec: PlanSpec, level: PlanLevel): number {
  return level.heightOverride ?? spec.storeyHeight;
}

/** Elevation of a level's finished floor, in metres above the lowest level. */
export function levelBaseZ(spec: PlanSpec, index: number): number {
  let z = 0;
  for (let i = 0; i < index && i < spec.levels.length; i++) {
    const level = spec.levels[i];
    z += levelHeight(spec, level) * Math.max(1, level.repeat);
  }
  return z;
}

/** The pixel height a level's Y axis is flipped about. */
export function flipHeightOf(level: PlanLevel, fallback: number): number {
  return level.image?.height ?? fallback;
}

export function emptyPlan(locationId: string): PlanSpec {
  const program = findProgram('office');
  return {
    name: 'Traced Plan',
    locationId,
    program: program.id,
    storeyHeight: program.storeyHeight,
    northAxis: 0,
    windowToWallRatio: program.windowToWallRatio,
    lockAspect: true,
    levels: [],
  };
}

export function newZoneId(): string {
  return `z_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function newLevelId(): string {
  return `l_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyLevel(name: string, image: ImageSource | null): PlanLevel {
  return {
    id: newLevelId(),
    name,
    image,
    zones: [],
    metresPerPixelX: 0.05,
    metresPerPixelY: 0.05,
    offsetX: 0,
    offsetY: 0,
    heightOverride: null,
    repeat: 1,
    calibration: null,
  };
}

/**
 * A level's drawing is a fixed resolution of some real extent, so a second
 * export of the same drawing at a different pixel size is registered exactly by
 * scaling metres-per-pixel inversely with the image size. That covers both the
 * common cases — identical exports, and the same plan at another resolution —
 * and leaves anything stranger to the align and offset controls.
 */
export function registerAgainst(level: PlanLevel, reference: PlanLevel): PlanLevel {
  if (!level.image || !reference.image) {
    return { ...level, metresPerPixelX: reference.metresPerPixelX,
      metresPerPixelY: reference.metresPerPixelY,
      offsetX: reference.offsetX, offsetY: reference.offsetY };
  }
  return {
    ...level,
    metresPerPixelX: reference.metresPerPixelX * (reference.image.width / level.image.width),
    metresPerPixelY: reference.metresPerPixelY * (reference.image.height / level.image.height),
    offsetX: reference.offsetX,
    offsetY: reference.offsetY,
  };
}
