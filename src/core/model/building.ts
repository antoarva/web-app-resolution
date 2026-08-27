/**
 * Derived building model.
 *
 * The IDF object list is flat: surfaces name their zone, windows name their
 * host surface. This module resolves those references into a tree the 3D view
 * and the simulation builder can both walk, with all polygon maths delegated to
 * the WebAssembly geometry kernel.
 */

import {
  type IdfModel, type IdfObject,
  objectsOfClass, objectName, numericField, textField, firstOfClass,
} from '@/core/idf/types';
import { loadEngine, writeInput, viewOutput } from '@/wasm/engine';
import { encodeGeometryRequest, decodeGeometryResult, type SurfaceGeometryResult } from '@/wasm/protocol';
import { getClassSchema } from '@/core/idd/schema';

export type Vec3 = [number, number, number];

export type SurfaceCategory = 'wall' | 'roof' | 'floor' | 'ceiling' | 'window' | 'door' | 'shading';
export type BoundaryKind = 'outdoors' | 'ground' | 'adiabatic' | 'surface' | 'zone' | 'other';

export interface ModelSurface {
  id: string;
  name: string;
  category: SurfaceCategory;
  constructionName: string;
  zoneName: string;
  boundary: BoundaryKind;
  boundaryObject: string;
  sunExposed: boolean;
  windExposed: boolean;
  /** World-coordinate ring, already offset by the zone origin. */
  vertices: Vec3[];
  area: number;
  /** Area with any child openings subtracted. */
  netArea: number;
  normal: Vec3;
  centroid: Vec3;
  tilt: number;
  azimuth: number;
  minZ: number;
  maxZ: number;
  /** Openings hosted by this surface. */
  children: ModelSurface[];
  /** Index into the flat surface list, used to map back to the IDF object. */
  objectId: string;
}

export interface ModelZone {
  id: string;
  name: string;
  origin: Vec3;
  multiplier: number;
  directionOfRelativeNorth: number;
  surfaces: ModelSurface[];
  floorArea: number;
  exteriorWallArea: number;
  windowArea: number;
  roofArea: number;
  volume: number;
  ceilingHeight: number;
  /** Glazing as a share of exterior wall area. */
  windowToWallRatio: number;
  objectId: string;
}

export interface ModelBounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  size: Vec3;
}

export interface SiteInfo {
  name: string;
  latitude: number;
  longitude: number;
  timeZone: number;
  elevation: number;
}

export interface BuildingModel {
  name: string;
  northAxis: number;
  terrain: string;
  site: SiteInfo;
  zones: ModelZone[];
  shading: ModelSurface[];
  bounds: ModelBounds;
  totals: {
    floorArea: number;
    exteriorWallArea: number;
    windowArea: number;
    roofArea: number;
    volume: number;
    zoneCount: number;
    surfaceCount: number;
    windowToWallRatio: number;
  };
}

const SURFACE_CLASS = 'BuildingSurface:Detailed';
const FENESTRATION_CLASS = 'FenestrationSurface:Detailed';
const SHADING_CLASS = 'Shading:Building:Detailed';

function categoriseSurface(surfaceType: string): SurfaceCategory {
  switch (surfaceType.trim().toLowerCase()) {
    case 'wall': return 'wall';
    case 'roof': return 'roof';
    case 'ceiling': return 'ceiling';
    case 'floor': return 'floor';
    case 'window': return 'window';
    case 'glassdoor': return 'window';
    case 'door': return 'door';
    default: return 'wall';
  }
}

function categoriseBoundary(boundary: string): BoundaryKind {
  const value = boundary.trim().toLowerCase();
  if (value === 'outdoors') return 'outdoors';
  if (value.startsWith('ground')) return 'ground';
  if (value === 'adiabatic') return 'adiabatic';
  if (value === 'surface') return 'surface';
  if (value === 'zone') return 'zone';
  return 'other';
}

/** Reads the repeating vertex tail that follows a class's declared fields. */
function readVertices(object: IdfObject, startIndex: number, origin: Vec3): Vec3[] {
  const vertices: Vec3[] = [];
  for (let i = startIndex; i + 2 < object.fields.length; i += 3) {
    const x = numericField(object, i, NaN);
    const y = numericField(object, i + 1, NaN);
    const z = numericField(object, i + 2, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) break;
    vertices.push([x + origin[0], y + origin[1], z + origin[2]]);
  }
  return vertices;
}

function vertexStartIndex(className: string, fallback: number): number {
  return getClassSchema(className)?.extensible?.startIndex ?? fallback;
}

const EMPTY_GEOMETRY: SurfaceGeometryResult = {
  area: 0, normal: [0, 0, 1], centroid: [0, 0, 0],
  tilt: 0, azimuth: 0, minZ: 0, maxZ: 0, volumeContribution: 0,
};

/**
 * Builds the derived model. Async because the geometry pass runs in WASM.
 */
export async function buildModel(model: IdfModel): Promise<BuildingModel> {
  const buildingObject = firstOfClass(model, 'Building');
  const locationObject = firstOfClass(model, 'Site:Location');

  // Zone origins are needed before surfaces, since Relative coordinates offset by them.
  const zoneObjects = objectsOfClass(model, 'Zone');
  const originByZone = new Map<string, Vec3>();
  for (const zone of zoneObjects) {
    originByZone.set(objectName(zone).toLowerCase(), [
      numericField(zone, 2, 0), numericField(zone, 3, 0), numericField(zone, 4, 0),
    ]);
  }

  // World coordinates mean the origin offset has already been applied in the file.
  const rules = firstOfClass(model, 'GlobalGeometryRules');
  const isWorld = textField(rules ?? { id: '', className: '', fields: [] }, 2, 'Relative').toLowerCase() === 'world';
  const originFor = (zoneName: string): Vec3 =>
    isWorld ? [0, 0, 0] : originByZone.get(zoneName.toLowerCase()) ?? [0, 0, 0];

  // --- Collect every polygon, then compute them all in one engine call ---
  const opaqueObjects = objectsOfClass(model, SURFACE_CLASS);
  const windowObjects = objectsOfClass(model, FENESTRATION_CLASS);
  const shadingObjects = objectsOfClass(model, SHADING_CLASS);

  const opaqueStart = vertexStartIndex(SURFACE_CLASS, 11);
  const windowStart = vertexStartIndex(FENESTRATION_CLASS, 9);
  const shadingStart = vertexStartIndex(SHADING_CLASS, 3);

  const opaqueVertices = opaqueObjects.map((object) =>
    readVertices(object, opaqueStart, originFor(textField(object, 3, ''))));

  // A window inherits its host surface's zone, so resolve the host first.
  const hostZoneByWindow = windowObjects.map((object) => {
    const hostName = textField(object, 3, '').toLowerCase();
    const host = opaqueObjects.find((candidate) => objectName(candidate).toLowerCase() === hostName);
    return host ? textField(host, 3, '') : '';
  });
  const windowVertices = windowObjects.map((object, index) =>
    readVertices(object, windowStart, originFor(hostZoneByWindow[index])));

  const shadingVertices = shadingObjects.map((object) => readVertices(object, shadingStart, [0, 0, 0]));

  const allRings = [...opaqueVertices, ...windowVertices, ...shadingVertices];
  let geometry: SurfaceGeometryResult[] = [];
  if (allRings.length > 0) {
    const engine = await loadEngine();
    writeInput(engine, encodeGeometryRequest(allRings));
    engine.computeGeometry();
    geometry = decodeGeometryResult(viewOutput(engine)).surfaces;
  }

  const geometryAt = (index: number): SurfaceGeometryResult => geometry[index] ?? EMPTY_GEOMETRY;

  // --- Assemble surfaces ---
  const opaqueSurfaces: ModelSurface[] = opaqueObjects.map((object, index) => {
    const info = geometryAt(index);
    return {
      id: object.id,
      objectId: object.id,
      name: objectName(object),
      category: categoriseSurface(textField(object, 1, 'Wall')),
      constructionName: textField(object, 2, ''),
      zoneName: textField(object, 3, ''),
      boundary: categoriseBoundary(textField(object, 5, 'Outdoors')),
      boundaryObject: textField(object, 6, ''),
      sunExposed: textField(object, 7, 'SunExposed').toLowerCase() === 'sunexposed',
      windExposed: textField(object, 8, 'WindExposed').toLowerCase() === 'windexposed',
      vertices: opaqueVertices[index],
      area: info.area,
      netArea: info.area,
      normal: info.normal,
      centroid: info.centroid,
      tilt: info.tilt,
      azimuth: info.azimuth,
      minZ: info.minZ,
      maxZ: info.maxZ,
      children: [],
    };
  });

  const surfaceByName = new Map<string, ModelSurface>();
  for (const surface of opaqueSurfaces) surfaceByName.set(surface.name.toLowerCase(), surface);

  windowObjects.forEach((object, index) => {
    const info = geometryAt(opaqueObjects.length + index);
    const hostName = textField(object, 3, '');
    const host = surfaceByName.get(hostName.toLowerCase());
    const multiplier = Math.max(1, numericField(object, 7, 1));
    const area = info.area * multiplier;

    const window: ModelSurface = {
      id: object.id,
      objectId: object.id,
      name: objectName(object),
      category: categoriseSurface(textField(object, 1, 'Window')),
      constructionName: textField(object, 2, ''),
      zoneName: host?.zoneName ?? '',
      boundary: 'outdoors',
      boundaryObject: textField(object, 4, ''),
      sunExposed: true,
      windExposed: true,
      vertices: windowVertices[index],
      area,
      netArea: area,
      normal: info.normal,
      centroid: info.centroid,
      // A window inherits the wall's orientation when its own ring is degenerate.
      tilt: info.area > 0 ? info.tilt : host?.tilt ?? 90,
      azimuth: info.area > 0 ? info.azimuth : host?.azimuth ?? 0,
      minZ: info.minZ,
      maxZ: info.maxZ,
      children: [],
    };

    if (host) {
      host.children.push(window);
      host.netArea = Math.max(0, host.netArea - area);
    }
  });

  const shading: ModelSurface[] = shadingObjects.map((object, index) => {
    const info = geometryAt(opaqueObjects.length + windowObjects.length + index);
    return {
      id: object.id,
      objectId: object.id,
      name: objectName(object),
      category: 'shading',
      constructionName: '',
      zoneName: '',
      boundary: 'other',
      boundaryObject: '',
      sunExposed: true,
      windExposed: true,
      vertices: shadingVertices[index],
      area: info.area,
      netArea: info.area,
      normal: info.normal,
      centroid: info.centroid,
      tilt: info.tilt,
      azimuth: info.azimuth,
      minZ: info.minZ,
      maxZ: info.maxZ,
      children: [],
    };
  });

  // --- Group surfaces into zones ---
  const surfacesByZone = new Map<string, ModelSurface[]>();
  for (const surface of opaqueSurfaces) {
    const key = surface.zoneName.toLowerCase();
    const list = surfacesByZone.get(key);
    if (list) list.push(surface);
    else surfacesByZone.set(key, [surface]);
  }

  const zones: ModelZone[] = zoneObjects.map((object) => {
    const name = objectName(object);
    const surfaces = surfacesByZone.get(name.toLowerCase()) ?? [];

    let floorArea = 0;
    let exteriorWallArea = 0;
    let windowArea = 0;
    let roofArea = 0;
    let volumeSum = 0;
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;

    for (const surface of surfaces) {
      if (surface.category === 'floor') floorArea += surface.area;
      if (surface.category === 'roof' || surface.category === 'ceiling') roofArea += surface.area;
      if (surface.category === 'wall' && surface.boundary === 'outdoors') exteriorWallArea += surface.area;
      for (const child of surface.children) windowArea += child.area;

      // Divergence theorem over the zone's closed surface set.
      volumeSum += (surface.centroid[0] * surface.normal[0]
        + surface.centroid[1] * surface.normal[1]
        + surface.centroid[2] * surface.normal[2]) * surface.area / 3;

      lowest = Math.min(lowest, surface.minZ);
      highest = Math.max(highest, surface.maxZ);
    }

    const height = Number.isFinite(lowest) && Number.isFinite(highest) ? highest - lowest : 0;
    // Prefer the value declared in the file; fall back to the computed one.
    const declaredVolume = numericField(object, 8, 0);
    const declaredFloorArea = numericField(object, 9, 0);
    const volume = declaredVolume > 0 ? declaredVolume : Math.abs(volumeSum);
    const resolvedFloorArea = declaredFloorArea > 0 ? declaredFloorArea : floorArea;

    return {
      id: object.id,
      objectId: object.id,
      name,
      origin: [numericField(object, 2, 0), numericField(object, 3, 0), numericField(object, 4, 0)],
      multiplier: Math.max(1, numericField(object, 6, 1)),
      directionOfRelativeNorth: numericField(object, 1, 0),
      surfaces,
      floorArea: resolvedFloorArea,
      exteriorWallArea,
      windowArea,
      roofArea,
      volume: volume > 0 ? volume : resolvedFloorArea * (height > 0 ? height : 3),
      ceilingHeight: height,
      windowToWallRatio: exteriorWallArea > 0 ? windowArea / (exteriorWallArea + windowArea) : 0,
    };
  });

  // --- Model extents, used to frame the 3D camera ---
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const consider = (vertices: Vec3[]): void => {
    for (const vertex of vertices) {
      for (let axis = 0; axis < 3; axis++) {
        if (vertex[axis] < min[axis]) min[axis] = vertex[axis];
        if (vertex[axis] > max[axis]) max[axis] = vertex[axis];
      }
    }
  };
  for (const surface of opaqueSurfaces) consider(surface.vertices);
  for (const surface of shading) consider(surface.vertices);

  if (!Number.isFinite(min[0])) {
    min[0] = min[1] = min[2] = 0;
    max[0] = max[1] = max[2] = 0;
  }

  const bounds: ModelBounds = {
    min, max,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };

  const totals = zones.reduce(
    (accumulator, zone) => ({
      floorArea: accumulator.floorArea + zone.floorArea * zone.multiplier,
      exteriorWallArea: accumulator.exteriorWallArea + zone.exteriorWallArea * zone.multiplier,
      windowArea: accumulator.windowArea + zone.windowArea * zone.multiplier,
      roofArea: accumulator.roofArea + zone.roofArea * zone.multiplier,
      volume: accumulator.volume + zone.volume * zone.multiplier,
      zoneCount: accumulator.zoneCount + 1,
      surfaceCount: accumulator.surfaceCount + zone.surfaces.length,
      windowToWallRatio: 0,
    }),
    { floorArea: 0, exteriorWallArea: 0, windowArea: 0, roofArea: 0, volume: 0, zoneCount: 0, surfaceCount: 0, windowToWallRatio: 0 },
  );
  totals.windowToWallRatio = totals.exteriorWallArea + totals.windowArea > 0
    ? totals.windowArea / (totals.exteriorWallArea + totals.windowArea)
    : 0;

  return {
    name: buildingObject ? objectName(buildingObject) : 'Untitled Building',
    northAxis: buildingObject ? numericField(buildingObject, 1, 0) : 0,
    terrain: buildingObject ? textField(buildingObject, 2, 'Suburbs') : 'Suburbs',
    site: {
      name: locationObject ? objectName(locationObject) : 'Unspecified Site',
      latitude: locationObject ? numericField(locationObject, 1, 0) : 0,
      longitude: locationObject ? numericField(locationObject, 2, 0) : 0,
      timeZone: locationObject ? numericField(locationObject, 3, 0) : 0,
      elevation: locationObject ? numericField(locationObject, 4, 0) : 0,
    },
    zones,
    shading,
    bounds,
    totals,
  };
}

/** Flattens every surface, including openings, for list views. */
export function allSurfaces(building: BuildingModel): ModelSurface[] {
  const result: ModelSurface[] = [];
  for (const zone of building.zones) {
    for (const surface of zone.surfaces) {
      result.push(surface);
      result.push(...surface.children);
    }
  }
  result.push(...building.shading);
  return result;
}
