/**
 * Engine entry point.
 *
 * The whole compute surface of the app lives behind these exports: parsing IDF
 * text, deriving surface geometry, and running the annual heat balance. The JS
 * side owns presentation only.
 */

export { allocInput, inputPtr, inputSize, outputPtr, outputLen } from "./bytes";
export { parseIdf } from "./idf/parser";
export { runSimulation, simulationProgress } from "./sim/engine";

import { ByteWriter, inputPtr, inputSize } from "./bytes";
import { computeSurface, accumulateVolume } from "./geom/polygon";

/** Semantic version of the engine ABI, surfaced in the About panel. */
export function engineVersion(): i32 {
  return 10000; // 1.00.00
}

/**
 * Batch geometry pass over every surface in the model.
 *
 * Input: i32 surfaceCount, then per surface i32 vertexCount followed by
 * vertexCount * 3 packed f64 coordinates.
 * Output: per surface area, normal xyz, centroid xyz, tilt, azimuth, minZ,
 * maxZ and its volume contribution, followed by the model's total volume.
 */
export function computeGeometry(): i32 {
  const base = inputPtr();
  const size = inputSize();
  if (size < 4) return 0;

  const surfaceCount = load<i32>(base);
  const writer = new ByteWriter(surfaceCount * 96 + 64);
  writer.writeI32(surfaceCount);
  writer.writeI32(0); // padding keeps the f64 payload aligned

  let cursor: usize = base + 4;
  let totalVolume: f64 = 0;

  for (let i = 0; i < surfaceCount; i++) {
    const vertexCount = load<i32>(cursor);
    cursor += 4;
    const geometry = computeSurface(cursor, vertexCount);
    cursor += <usize>(vertexCount * 24);

    const contribution = accumulateVolume(
      geometry.centroidX, geometry.centroidY, geometry.centroidZ,
      geometry.normalX, geometry.normalY, geometry.normalZ,
      geometry.area
    );
    totalVolume += contribution;

    writer.writeF64(geometry.area);
    writer.writeF64(geometry.normalX);
    writer.writeF64(geometry.normalY);
    writer.writeF64(geometry.normalZ);
    writer.writeF64(geometry.centroidX);
    writer.writeF64(geometry.centroidY);
    writer.writeF64(geometry.centroidZ);
    writer.writeF64(geometry.tilt);
    writer.writeF64(geometry.azimuth);
    writer.writeF64(geometry.minZ);
    writer.writeF64(geometry.maxZ);
    writer.writeF64(contribution);
  }

  writer.writeF64(Math.abs(totalVolume));
  writer.finish();
  return surfaceCount;
}
