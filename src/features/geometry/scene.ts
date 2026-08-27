/**
 * Three.js scene construction for the model viewport.
 *
 * IDF geometry is Z-up; Three.js defaults to Y-up. Rather than rotating every
 * vertex, the camera is configured with `up = +Z` and the grid is laid in the
 * XY plane, so coordinates shown in the UI match the coordinates in the file.
 */

import * as THREE from 'three';
import type { BuildingModel, ModelSurface, Vec3 } from '@/core/model/building';

export interface SurfaceColors {
  wall: number;
  roof: number;
  floor: number;
  ceiling: number;
  window: number;
  door: number;
  shading: number;
  ground: number;
  adiabatic: number;
}

export const LIGHT_COLORS: SurfaceColors = {
  wall: 0xd8dee9, roof: 0xb45309, floor: 0x94a3b8, ceiling: 0xcbd5e1,
  window: 0x38bdf8, door: 0x78716c, shading: 0x64748b,
  ground: 0x78716c, adiabatic: 0xa8a29e,
};

export const DARK_COLORS: SurfaceColors = {
  wall: 0x64748b, roof: 0xb45309, floor: 0x475569, ceiling: 0x52525b,
  window: 0x38bdf8, door: 0x57534e, shading: 0x475569,
  ground: 0x57534e, adiabatic: 0x525252,
};

/** Distinct hue per zone, for the "colour by zone" mode. */
export function zoneColor(index: number): number {
  const hue = (index * 0.618033988749895) % 1; // golden-ratio spacing
  return new THREE.Color().setHSL(hue, 0.55, 0.55).getHex();
}

export type ColorMode = 'surface-type' | 'zone' | 'construction' | 'orientation';

/**
 * Triangulates a planar polygon by fanning from its first vertex.
 * Surface rings in an IDF are convex in practice, which makes a fan valid.
 */
function triangulate(vertices: Vec3[]): { positions: Float32Array; indices: number[] } {
  const positions = new Float32Array(vertices.length * 3);
  vertices.forEach((vertex, index) => {
    positions[index * 3] = vertex[0];
    positions[index * 3 + 1] = vertex[1];
    positions[index * 3 + 2] = vertex[2];
  });

  const indices: number[] = [];
  for (let i = 1; i < vertices.length - 1; i++) {
    indices.push(0, i, i + 1);
  }
  return { positions, indices };
}

export interface SurfaceMeshUserData {
  surfaceId: string;
  surfaceName: string;
  zoneName: string;
  category: string;
  area: number;
}

function materialFor(color: number, category: string, opacity: number): THREE.Material {
  const transparent = category === 'window' || opacity < 1;
  return new THREE.MeshLambertMaterial({
    color,
    side: THREE.DoubleSide,
    transparent,
    opacity: category === 'window' ? Math.min(opacity, 0.45) : opacity,
    depthWrite: category !== 'window',
  });
}

function colorFor(
  surface: ModelSurface,
  mode: ColorMode,
  colors: SurfaceColors,
  zoneIndex: number,
  constructionIndex: number,
): number {
  if (mode === 'zone') {
    return surface.category === 'window' ? colors.window : zoneColor(zoneIndex);
  }
  if (mode === 'construction') {
    return surface.category === 'window' ? colors.window : zoneColor(constructionIndex);
  }
  if (mode === 'orientation') {
    if (surface.category === 'window') return colors.window;
    if (surface.category === 'roof' || surface.category === 'ceiling') return colors.roof;
    if (surface.category === 'floor') return colors.floor;
    // Hue by compass direction, so facades read at a glance.
    const hue = (((surface.azimuth % 360) + 360) % 360) / 360;
    return new THREE.Color().setHSL(hue, 0.5, 0.55).getHex();
  }

  // surface-type
  if (surface.boundary === 'ground') return colors.ground;
  if (surface.boundary === 'adiabatic' && surface.category === 'wall') return colors.adiabatic;
  return colors[surface.category as keyof SurfaceColors] ?? colors.wall;
}

export interface BuildOptions {
  colors: SurfaceColors;
  mode: ColorMode;
  showEdges: boolean;
  /** Surfaces not in this set are dimmed; empty means show everything fully. */
  highlighted?: Set<string>;
}

/**
 * Builds the mesh group for a model. Returns the group plus a lookup from mesh
 * uuid to surface id, which the raycaster uses for picking.
 */
export function buildSurfaceGroup(building: BuildingModel, options: BuildOptions): {
  group: THREE.Group;
  pickTargets: THREE.Mesh[];
} {
  const group = new THREE.Group();
  group.name = 'building';
  const pickTargets: THREE.Mesh[] = [];

  const constructionIndices = new Map<string, number>();
  const constructionIndexOf = (name: string): number => {
    const existing = constructionIndices.get(name);
    if (existing !== undefined) return existing;
    const next = constructionIndices.size;
    constructionIndices.set(name, next);
    return next;
  };

  const addSurface = (surface: ModelSurface, zoneIndex: number): void => {
    if (surface.vertices.length < 3) return;

    const { positions, indices } = triangulate(surface.vertices);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const dimmed = options.highlighted !== undefined
      && options.highlighted.size > 0
      && !options.highlighted.has(surface.id);
    const opacity = dimmed ? 0.15 : 1;

    const color = colorFor(surface, options.mode, options.colors, zoneIndex,
      constructionIndexOf(surface.constructionName));
    const mesh = new THREE.Mesh(geometry, materialFor(color, surface.category, opacity));
    mesh.name = surface.name;
    mesh.userData = {
      surfaceId: surface.id,
      surfaceName: surface.name,
      zoneName: surface.zoneName,
      category: surface.category,
      area: surface.area,
    } satisfies SurfaceMeshUserData;

    // Windows sit in the same plane as their wall; nudge them out to avoid
    // z-fighting rather than offsetting the source geometry.
    if (surface.category === 'window' || surface.category === 'door') {
      mesh.position.set(
        surface.normal[0] * 0.02, surface.normal[1] * 0.02, surface.normal[2] * 0.02,
      );
      mesh.renderOrder = 1;
    }

    group.add(mesh);
    if (!dimmed) pickTargets.push(mesh);

    if (options.showEdges) {
      const edges = new THREE.EdgesGeometry(geometry, 1);
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({
          color: 0x1e293b, transparent: true, opacity: dimmed ? 0.1 : 0.35,
        }),
      );
      line.position.copy(mesh.position);
      group.add(line);
    }
  };

  building.zones.forEach((zone, zoneIndex) => {
    for (const surface of zone.surfaces) {
      addSurface(surface, zoneIndex);
      for (const child of surface.children) addSurface(child, zoneIndex);
    }
  });
  for (const surface of building.shading) addSurface(surface, -1);

  return { group, pickTargets };
}

/** Ground plane and axis grid sized to the model. */
export function buildGrid(building: BuildingModel, dark: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'grid';

  const span = Math.max(building.bounds.size[0], building.bounds.size[1], 10);
  const extent = Math.ceil((span * 1.8) / 5) * 5;

  const grid = new THREE.GridHelper(
    extent * 2, Math.max(4, Math.round((extent * 2) / 5)),
    dark ? 0x475569 : 0x94a3b8,
    dark ? 0x334155 : 0xcbd5e1,
  );
  // GridHelper lies in XZ; rotate it into the XY plane for a Z-up world.
  grid.rotation.x = Math.PI / 2;
  grid.position.set(building.bounds.center[0], building.bounds.center[1], building.bounds.min[2] - 0.05);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.4;
  group.add(grid);

  // North arrow, so orientation is unambiguous.
  const arrowLength = extent * 0.22;
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(
      building.bounds.center[0],
      building.bounds.max[1] + extent * 0.12,
      building.bounds.min[2],
    ),
    arrowLength,
    dark ? 0xf87171 : 0xdc2626,
    arrowLength * 0.25,
    arrowLength * 0.15,
  );
  group.add(arrow);

  return group;
}

export function buildLighting(dark: boolean): THREE.Group {
  const group = new THREE.Group();
  group.name = 'lighting';

  group.add(new THREE.AmbientLight(0xffffff, dark ? 1.1 : 1.4));

  // Key light from the south-west, roughly where the sun sits mid-afternoon.
  const key = new THREE.DirectionalLight(0xffffff, dark ? 1.5 : 1.8);
  key.position.set(-1, -1.4, 2.2);
  group.add(key);

  // Fill from the opposite side keeps north faces readable.
  const fill = new THREE.DirectionalLight(0xffffff, dark ? 0.5 : 0.6);
  fill.position.set(1.5, 1, 0.8);
  group.add(fill);

  return group;
}

/** Frames the camera on the model with a comfortable margin. */
export function frameCamera(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  building: BuildingModel,
): void {
  const size = building.bounds.size;
  const radius = Math.max(Math.hypot(size[0], size[1], size[2]) / 2, 5);
  const distance = radius / Math.sin((camera.fov * Math.PI) / 360) * 1.15;

  target.set(building.bounds.center[0], building.bounds.center[1], building.bounds.center[2]);
  // Approach from the south-east and above: the standard architectural view.
  camera.position.set(
    target.x + distance * 0.62,
    target.y - distance * 0.68,
    target.z + distance * 0.48,
  );
  camera.lookAt(target);
  camera.near = Math.max(0.1, distance / 1000);
  camera.far = distance * 12;
  camera.updateProjectionMatrix();
}
