/**
 * Binary protocol shared with the engine.
 *
 * Field order in every encoder/decoder here is load-bearing: it must match
 * `engine/assembly/sim/engine.ts` and `engine/assembly/index.ts` exactly.
 * Everything is little-endian, which is the WebAssembly memory convention.
 */

export interface IdfObjectRaw {
  className: string;
  fields: string[];
}

export interface SurfaceGeometryResult {
  area: number;
  normal: [number, number, number];
  centroid: [number, number, number];
  tilt: number;
  azimuth: number;
  minZ: number;
  maxZ: number;
  volumeContribution: number;
}

export interface GeometryResult {
  surfaces: SurfaceGeometryResult[];
  totalVolume: number;
}

export interface ClimateInput {
  meanTemp: number;
  annualAmplitude: number;
  dailyAmplitude: number;
  peakDay: number;
  clearness: number;
  humidity: number;
  groundTemp: number;
  windSpeed: number;
}

export interface ZoneInput {
  floorArea: number;
  volume: number;
  thermalMass: number;
  lightingW: number;
  equipmentW: number;
  peopleCount: number;
  infiltrationACH: number;
  heatingSetpoint: number;
  coolingSetpoint: number;
  heatingCapacity: number;
  coolingCapacity: number;
  surfaceStart: number;
  surfaceCount: number;
  scheduleKind: number;
}

export interface SurfaceInput {
  area: number;
  uValue: number;
  tilt: number;
  azimuth: number;
  shgc: number;
  absorptance: number;
  kind: number;
  boundary: number;
}

export interface SimulationInput {
  latitude: number;
  longitude: number;
  timeZone: number;
  elevation: number;
  startDay: number;
  numDays: number;
  timestepsPerHour: number;
  climate: ClimateInput;
  zones: ZoneInput[];
  surfaces: SurfaceInput[];
}

export interface ZoneSummary {
  heatingKWh: number;
  coolingKWh: number;
  lightingKWh: number;
  equipmentKWh: number;
  peakHeatingW: number;
  peakCoolingW: number;
  minTemp: number;
  maxTemp: number;
  unmetHeatingHours: number;
  unmetCoolingHours: number;
  solarKWh: number;
  infiltrationKWh: number;
  envelopeKWh: number;
  latentKWh: number;
}

export interface ZoneSeries {
  temperature: Float64Array;
  heating: Float64Array;
  cooling: Float64Array;
}

export interface SimulationResult {
  zoneCount: number;
  hours: number;
  timestepsPerHour: number;
  days: number;
  outdoorTemp: Float64Array;
  globalSolar: Float64Array;
  zoneSeries: ZoneSeries[];
  zoneSummaries: ZoneSummary[];
}

export const SURFACE_KIND = { wall: 0, roof: 1, floor: 2, window: 3 } as const;
export const BOUNDARY = { outdoors: 0, ground: 1, adiabatic: 2, interzone: 3 } as const;
export const SCHEDULE_KIND = { office: 0, residential: 1, continuous: 2 } as const;

const ZONE_RECORD_BYTES = 104;
const SURFACE_RECORD_BYTES = 56;
const HEADER_BYTES = 56;
const CLIMATE_BYTES = 64;
const SUMMARY_FIELDS = 14;

/** Sequential little-endian writer over a pre-sized buffer. */
class Writer {
  private view: DataView;
  private offset = 0;

  constructor(public readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  i32(value: number): void {
    this.view.setInt32(this.offset, value | 0, true);
    this.offset += 4;
  }

  f64(value: number): void {
    // Guard against NaN reaching the solver, where it would poison every zone.
    this.view.setFloat64(this.offset, Number.isFinite(value) ? value : 0, true);
    this.offset += 8;
  }
}

/** Decodes the flat object table produced by `parseIdf`. */
export function decodeIdfObjects(buffer: Uint8Array): IdfObjectRaw[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;

  const objectCount = view.getInt32(offset, true);
  offset += 4;

  const objects: IdfObjectRaw[] = new Array(objectCount);
  for (let i = 0; i < objectCount; i++) {
    const fieldCount = view.getInt32(offset, true);
    offset += 4;

    let className = '';
    const fields: string[] = [];
    for (let f = 0; f < fieldCount; f++) {
      const length = view.getInt32(offset, true);
      offset += 4;
      const text = length > 0 ? decoder.decode(buffer.subarray(offset, offset + length)) : '';
      offset += length;
      if (f === 0) className = text;
      else fields.push(text);
    }
    objects[i] = { className, fields };
  }
  return objects;
}

/** Packs surface vertex rings for the batch geometry pass. */
export function encodeGeometryRequest(surfaces: number[][][]): Uint8Array {
  let size = 4;
  for (const vertices of surfaces) size += 4 + vertices.length * 24;

  const bytes = new Uint8Array(size);
  const writer = new Writer(bytes);
  writer.i32(surfaces.length);
  for (const vertices of surfaces) {
    writer.i32(vertices.length);
    for (const vertex of vertices) {
      writer.f64(vertex[0]);
      writer.f64(vertex[1]);
      writer.f64(vertex[2]);
    }
  }
  return bytes;
}

export function decodeGeometryResult(view: DataView): GeometryResult {
  let offset = 0;
  const count = view.getInt32(offset, true);
  offset += 8; // count + padding

  const surfaces: SurfaceGeometryResult[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const read = (): number => {
      const value = view.getFloat64(offset, true);
      offset += 8;
      return value;
    };
    surfaces[i] = {
      area: read(),
      normal: [read(), read(), read()],
      centroid: [read(), read(), read()],
      tilt: read(),
      azimuth: read(),
      minZ: read(),
      maxZ: read(),
      volumeContribution: read(),
    };
  }
  const totalVolume = count > 0 ? view.getFloat64(offset, true) : 0;
  return { surfaces, totalVolume };
}

export function encodeSimulationRequest(input: SimulationInput): Uint8Array {
  const size =
    HEADER_BYTES +
    CLIMATE_BYTES +
    input.zones.length * ZONE_RECORD_BYTES +
    input.surfaces.length * SURFACE_RECORD_BYTES;

  const bytes = new Uint8Array(size);
  const writer = new Writer(bytes);

  writer.f64(input.latitude);
  writer.f64(input.longitude);
  writer.f64(input.timeZone);
  writer.f64(input.elevation);
  writer.i32(input.startDay);
  writer.i32(input.numDays);
  writer.i32(input.timestepsPerHour);
  writer.i32(input.zones.length);
  writer.i32(input.surfaces.length);
  writer.i32(0); // alignment padding

  const climate = input.climate;
  writer.f64(climate.meanTemp);
  writer.f64(climate.annualAmplitude);
  writer.f64(climate.dailyAmplitude);
  writer.f64(climate.peakDay);
  writer.f64(climate.clearness);
  writer.f64(climate.humidity);
  writer.f64(climate.groundTemp);
  writer.f64(climate.windSpeed);

  for (const zone of input.zones) {
    writer.f64(zone.floorArea);
    writer.f64(zone.volume);
    writer.f64(zone.thermalMass);
    writer.f64(zone.lightingW);
    writer.f64(zone.equipmentW);
    writer.f64(zone.peopleCount);
    writer.f64(zone.infiltrationACH);
    writer.f64(zone.heatingSetpoint);
    writer.f64(zone.coolingSetpoint);
    writer.f64(zone.heatingCapacity);
    writer.f64(zone.coolingCapacity);
    writer.i32(zone.surfaceStart);
    writer.i32(zone.surfaceCount);
    writer.i32(zone.scheduleKind);
    writer.i32(0); // alignment padding
  }

  for (const surface of input.surfaces) {
    writer.f64(surface.area);
    writer.f64(surface.uValue);
    writer.f64(surface.tilt);
    writer.f64(surface.azimuth);
    writer.f64(surface.shgc);
    writer.f64(surface.absorptance);
    writer.i32(surface.kind);
    writer.i32(surface.boundary);
  }

  return bytes;
}

export function decodeSimulationResult(buffer: Uint8Array): SimulationResult {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;

  const zoneCount = view.getInt32(offset, true);
  const hours = view.getInt32(offset + 4, true);
  const timestepsPerHour = view.getInt32(offset + 8, true);
  const days = view.getInt32(offset + 12, true);
  offset += 16;

  const readSeries = (length: number): Float64Array => {
    const series = new Float64Array(length);
    for (let i = 0; i < length; i++) series[i] = view.getFloat64(offset + i * 8, true);
    offset += length * 8;
    return series;
  };

  const outdoorTemp = readSeries(hours);
  const globalSolar = readSeries(hours);

  const zoneSeries: ZoneSeries[] = new Array(zoneCount);
  for (let z = 0; z < zoneCount; z++) {
    zoneSeries[z] = {
      temperature: readSeries(hours),
      heating: readSeries(hours),
      cooling: readSeries(hours),
    };
  }

  const zoneSummaries: ZoneSummary[] = new Array(zoneCount);
  for (let z = 0; z < zoneCount; z++) {
    const values = new Array<number>(SUMMARY_FIELDS);
    for (let i = 0; i < SUMMARY_FIELDS; i++) {
      values[i] = view.getFloat64(offset, true);
      offset += 8;
    }
    zoneSummaries[z] = {
      heatingKWh: values[0],
      coolingKWh: values[1],
      lightingKWh: values[2],
      equipmentKWh: values[3],
      peakHeatingW: values[4],
      peakCoolingW: values[5],
      minTemp: values[6],
      maxTemp: values[7],
      unmetHeatingHours: values[8],
      unmetCoolingHours: values[9],
      solarKWh: values[10],
      infiltrationKWh: values[11],
      envelopeKWh: values[12],
      latentKWh: values[13],
    };
  }

  return { zoneCount, hours, timestepsPerHour, days, outdoorTemp, globalSolar, zoneSeries, zoneSummaries };
}
