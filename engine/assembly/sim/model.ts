/**
 * Decoded simulation request.
 *
 * The host serialises the building into one flat little-endian blob; these
 * classes are the engine-side view of it. Field order here must stay in step
 * with `src/wasm/protocol.ts` on the JS side.
 */

import { ClimateProfile } from "./weather";

export const SURFACE_WALL: i32 = 0;
export const SURFACE_ROOF: i32 = 1;
export const SURFACE_FLOOR: i32 = 2;
export const SURFACE_WINDOW: i32 = 3;

export const BOUNDARY_OUTDOORS: i32 = 0;
export const BOUNDARY_GROUND: i32 = 1;
export const BOUNDARY_ADIABATIC: i32 = 2;
export const BOUNDARY_INTERZONE: i32 = 3;

export const SCHEDULE_OFFICE: i32 = 0;
export const SCHEDULE_RESIDENTIAL: i32 = 1;
export const SCHEDULE_CONTINUOUS: i32 = 2;

export class Surface {
  area: f64 = 0;
  /** Overall heat transfer coefficient including films, W/m2K. */
  uValue: f64 = 0;
  tilt: f64 = 90;
  azimuth: f64 = 0;
  /** Solar heat gain coefficient, windows only. */
  shgc: f64 = 0;
  /** Exterior solar absorptance, opaque surfaces only. */
  absorptance: f64 = 0.7;
  kind: i32 = SURFACE_WALL;
  boundary: i32 = BOUNDARY_OUTDOORS;
}

export class Zone {
  floorArea: f64 = 0;
  volume: f64 = 0;
  /** Effective construction capacitance, kJ/K. */
  thermalMass: f64 = 0;
  lightingW: f64 = 0;
  equipmentW: f64 = 0;
  peopleCount: f64 = 0;
  infiltrationACH: f64 = 0.5;
  heatingSetpoint: f64 = 20;
  coolingSetpoint: f64 = 24;
  /** Zero means autosize: the ideal-loads system is never capacity limited. */
  heatingCapacity: f64 = 0;
  coolingCapacity: f64 = 0;
  surfaceStart: i32 = 0;
  surfaceCount: i32 = 0;
  scheduleKind: i32 = SCHEDULE_OFFICE;
}

export class SimulationRequest {
  latitude: f64 = 41.98;
  longitude: f64 = -87.92;
  timeZone: f64 = -6;
  elevation: f64 = 201;
  startDay: i32 = 1;
  numDays: i32 = 365;
  timestepsPerHour: i32 = 4;
  climate: ClimateProfile = new ClimateProfile();
  zones: Zone[] = [];
  surfaces: Surface[] = [];
}

/**
 * Fraction of design internal gain active at a given hour.
 * Weekends fall back to a small standby load rather than zero.
 */
export function scheduleFraction(kind: i32, hour: f64, dayOfWeek: i32): f64 {
  const isWeekend = dayOfWeek == 0 || dayOfWeek == 6;

  if (kind == SCHEDULE_CONTINUOUS) return 1.0;

  if (kind == SCHEDULE_RESIDENTIAL) {
    if (hour >= 23.0 || hour < 6.0) return 0.35;
    if (hour < 8.0) return 0.8;
    if (hour < 16.0) return isWeekend ? 0.6 : 0.3;
    return 0.95;
  }

  // Office: ramp up before the workday, decay through the evening.
  if (isWeekend) return 0.1;
  if (hour < 6.0 || hour >= 21.0) return 0.05;
  if (hour < 8.0) return 0.3;
  if (hour < 12.0) return 0.95;
  if (hour < 13.0) return 0.75;
  if (hour < 17.0) return 0.95;
  if (hour < 19.0) return 0.5;
  return 0.2;
}
