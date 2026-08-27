/**
 * Parametric geometry for the starter templates.
 *
 * Vertex ordering follows the GlobalGeometryRules the templates declare:
 * UpperLeftCorner, Counterclockwise, World. For a footprint edge walked
 * counterclockwise when seen from above, emitting
 * [start-top, start-base, end-base, end-top] yields an outward-facing normal,
 * which is what makes azimuths come out right for solar gain.
 */

export type Point2 = [number, number];
export type Vertex = [number, number, number];

export interface WallSpec {
  vertices: Vertex[];
  /** Compass azimuth of the outward normal, for naming and window placement. */
  azimuth: number;
  width: number;
  height: number;
  start: Point2;
  end: Point2;
}

/** Rectangle footprint, counterclockwise from the south-west corner. */
export function rectangleFootprint(
  originX: number, originY: number, width: number, depth: number,
): Point2[] {
  return [
    [originX, originY],
    [originX + width, originY],
    [originX + width, originY + depth],
    [originX, originY + depth],
  ];
}

function azimuthOf(start: Point2, end: Point2): number {
  // Outward normal of a counterclockwise edge points to its right-hand side.
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const normalX = dy;
  const normalY = -dx;
  let azimuth = (Math.atan2(normalX, normalY) * 180) / Math.PI;
  if (azimuth < 0) azimuth += 360;
  return azimuth;
}

export function wallsFromFootprint(footprint: Point2[], baseZ: number, height: number): WallSpec[] {
  const walls: WallSpec[] = [];
  for (let i = 0; i < footprint.length; i++) {
    const start = footprint[i];
    const end = footprint[(i + 1) % footprint.length];
    const width = Math.hypot(end[0] - start[0], end[1] - start[1]);
    walls.push({
      vertices: [
        [start[0], start[1], baseZ + height],
        [start[0], start[1], baseZ],
        [end[0], end[1], baseZ],
        [end[0], end[1], baseZ + height],
      ],
      azimuth: azimuthOf(start, end),
      width,
      height,
      start,
      end,
    });
  }
  return walls;
}

/** Roof ring: counterclockwise seen from above, so the normal points up. */
export function roofVertices(footprint: Point2[], z: number): Vertex[] {
  return footprint.map(([x, y]) => [x, y, z] as Vertex);
}

/** Floor ring: reversed, so the normal points down. */
export function floorVertices(footprint: Point2[], z: number): Vertex[] {
  return footprint.slice().reverse().map(([x, y]) => [x, y, z] as Vertex);
}

/**
 * A window centred on a wall, sized to hit `windowToWallRatio` while keeping
 * a sill height and a margin from each jamb.
 */
export function windowOnWall(
  wall: WallSpec,
  windowToWallRatio: number,
  sillHeight = 0.8,
  jambMargin = 0.3,
): Vertex[] | null {
  const wallArea = wall.width * wall.height;
  const targetArea = wallArea * windowToWallRatio;
  if (targetArea <= 0.1) return null;

  const maxWidth = Math.max(0.3, wall.width - jambMargin * 2);
  const maxHeight = Math.max(0.3, wall.height - sillHeight - 0.3);

  // Keep the opening proportional to the wall, then clamp to what fits.
  let width = Math.min(maxWidth, Math.sqrt(targetArea * (wall.width / wall.height)));
  let height = targetArea / width;
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.min(maxWidth, targetArea / height);
  }
  if (width < 0.3 || height < 0.3) return null;

  // Interpolate along the wall's base edge to place the opening.
  const dx = (wall.end[0] - wall.start[0]) / wall.width;
  const dy = (wall.end[1] - wall.start[1]) / wall.width;
  const startOffset = (wall.width - width) / 2;
  const endOffset = startOffset + width;

  const baseZ = wall.vertices[1][2];
  const sill = baseZ + sillHeight;
  const head = sill + height;

  const p1: Point2 = [wall.start[0] + dx * startOffset, wall.start[1] + dy * startOffset];
  const p2: Point2 = [wall.start[0] + dx * endOffset, wall.start[1] + dy * endOffset];

  return [
    [p1[0], p1[1], head],
    [p1[0], p1[1], sill],
    [p2[0], p2[1], sill],
    [p2[0], p2[1], head],
  ];
}

/** Compass label for an azimuth, used in generated object names. */
export function orientationName(azimuth: number): string {
  const normalised = ((azimuth % 360) + 360) % 360;
  if (normalised >= 315 || normalised < 45) return 'N';
  if (normalised < 135) return 'E';
  if (normalised < 225) return 'S';
  return 'W';
}

export function formatVertex([x, y, z]: Vertex): string {
  const round = (value: number): string => (Math.round(value * 1000) / 1000).toString();
  return `${round(x)}, ${round(y)}, ${round(z)}`;
}
