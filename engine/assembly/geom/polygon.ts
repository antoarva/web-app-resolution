/**
 * Planar-polygon kernel for building surfaces.
 *
 * Surface vertices in an IDF are arbitrary 3D polygons, so area and orientation
 * both come from Newell's method, which is stable for non-convex and slightly
 * non-planar rings alike.
 */

export class SurfaceGeometry {
  area: f64 = 0;
  normalX: f64 = 0;
  normalY: f64 = 0;
  normalZ: f64 = 0;
  centroidX: f64 = 0;
  centroidY: f64 = 0;
  centroidZ: f64 = 0;
  /** Degrees from horizontal-up: 0 = roof, 90 = wall, 180 = floor. */
  tilt: f64 = 0;
  /** Degrees clockwise from north, matching EnergyPlus convention. */
  azimuth: f64 = 0;
  minZ: f64 = 0;
  maxZ: f64 = 0;
}

const RAD_TO_DEG: f64 = 57.29577951308232;

/**
 * `vertices` holds count * 3 packed f64 coordinates starting at `ptr`.
 */
export function computeSurface(ptr: usize, count: i32): SurfaceGeometry {
  const out = new SurfaceGeometry();
  if (count < 3) return out;

  let nx: f64 = 0, ny: f64 = 0, nz: f64 = 0;
  let cx: f64 = 0, cy: f64 = 0, cz: f64 = 0;
  let lo: f64 = f64.MAX_VALUE, hi: f64 = -f64.MAX_VALUE;

  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const ax = load<f64>(ptr + <usize>(i * 24));
    const ay = load<f64>(ptr + <usize>(i * 24 + 8));
    const az = load<f64>(ptr + <usize>(i * 24 + 16));
    const bx = load<f64>(ptr + <usize>(j * 24));
    const by = load<f64>(ptr + <usize>(j * 24 + 8));
    const bz = load<f64>(ptr + <usize>(j * 24 + 16));

    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);

    cx += ax; cy += ay; cz += az;
    if (az < lo) lo = az;
    if (az > hi) hi = az;
  }

  const magnitude = Math.sqrt(nx * nx + ny * ny + nz * nz);
  out.area = 0.5 * magnitude;
  const inv = <f64>count;
  out.centroidX = cx / inv;
  out.centroidY = cy / inv;
  out.centroidZ = cz / inv;
  out.minZ = lo;
  out.maxZ = hi;

  if (magnitude > 1e-12) {
    out.normalX = nx / magnitude;
    out.normalY = ny / magnitude;
    out.normalZ = nz / magnitude;

    let tilt = Math.acos(clamp(out.normalZ, -1.0, 1.0)) * RAD_TO_DEG;
    out.tilt = tilt;

    // Azimuth is only meaningful once the surface leans away from horizontal.
    const horizontal = Math.sqrt(out.normalX * out.normalX + out.normalY * out.normalY);
    if (horizontal > 1e-9) {
      let az = Math.atan2(out.normalX, out.normalY) * RAD_TO_DEG;
      if (az < 0) az += 360.0;
      out.azimuth = az;
    }
  }
  return out;
}

// @inline
export function clamp(value: f64, lo: f64, hi: f64): f64 {
  return value < lo ? lo : (value > hi ? hi : value);
}

/**
 * Signed volume of a closed surface set via the divergence theorem.
 * Each face contributes (centroid · normal) * area / 3.
 */
export function accumulateVolume(
  centroidX: f64, centroidY: f64, centroidZ: f64,
  normalX: f64, normalY: f64, normalZ: f64,
  area: f64
): f64 {
  return (centroidX * normalX + centroidY * normalY + centroidZ * normalZ) * area / 3.0;
}
