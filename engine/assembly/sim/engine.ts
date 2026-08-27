/**
 * Zone heat-balance solver.
 *
 * Each zone is a single well-mixed air node with a lumped capacitance covering
 * the air plus the fraction of construction mass that participates on an hourly
 * cycle. The solver marches at sub-hourly timesteps for numerical stability and
 * reports hourly means, which is what the results views consume.
 *
 * Per timestep the net gain on a zone is:
 *   Q = Q_envelope + Q_solar + Q_internal + Q_infiltration + Q_hvac
 * with an ideal-loads system supplying exactly the Q_hvac needed to hold the
 * active setpoint, subject to any capacity limit.
 */

import { ByteReader, ByteWriter } from "../bytes";
import { ClimateProfile, outdoorTemperature, exteriorFilmCoefficient, skyTemperature } from "./weather";
import { sunPosition, incidentOnSurface, SunPosition } from "./solar";
import {
  SimulationRequest, Zone, Surface, scheduleFraction,
  SURFACE_WINDOW, SURFACE_ROOF,
  BOUNDARY_OUTDOORS, BOUNDARY_GROUND,
} from "./model";

const AIR_DENSITY: f64 = 1.204;      // kg/m3 at 20degC
const AIR_HEAT_CAPACITY: f64 = 1005; // J/kgK
const SENSIBLE_PER_PERSON: f64 = 73.0;  // W, ASHRAE seated light work
const LATENT_PER_PERSON: f64 = 59.0;    // W
const GROUND_REFLECTANCE: f64 = 0.2;
const SETBACK_DELTA: f64 = 4.0;
/** Optimum-start ramp, K/h. Bounds the recovery spike after a setback. */
const SETPOINT_RAMP_RATE: f64 = 3.0;
const STEFAN_BOLTZMANN: f64 = 5.67e-8;

/** Progress is polled by the host between chunks so the UI can show a bar. */
let progressStep: i32 = 0;
let progressTotal: i32 = 1;

export function simulationProgress(): f64 {
  return progressTotal > 0 ? <f64>progressStep / <f64>progressTotal : 0.0;
}

function readRequest(): SimulationRequest {
  const reader = new ByteReader();
  const request = new SimulationRequest();

  request.latitude = reader.readF64();
  request.longitude = reader.readF64();
  request.timeZone = reader.readF64();
  request.elevation = reader.readF64();
  request.startDay = reader.readI32();
  request.numDays = reader.readI32();
  request.timestepsPerHour = reader.readI32();
  const zoneCount = reader.readI32();
  const surfaceCount = reader.readI32();
  reader.skip(4); // keeps the following f64 block 8-byte aligned

  const climate = new ClimateProfile();
  climate.meanTemp = reader.readF64();
  climate.annualAmplitude = reader.readF64();
  climate.dailyAmplitude = reader.readF64();
  climate.peakDay = reader.readF64();
  climate.clearness = reader.readF64();
  climate.humidity = reader.readF64();
  climate.groundTemp = reader.readF64();
  climate.windSpeed = reader.readF64();
  request.climate = climate;

  for (let i = 0; i < zoneCount; i++) {
    const zone = new Zone();
    zone.floorArea = reader.readF64();
    zone.volume = reader.readF64();
    zone.thermalMass = reader.readF64();
    zone.lightingW = reader.readF64();
    zone.equipmentW = reader.readF64();
    zone.peopleCount = reader.readF64();
    zone.infiltrationACH = reader.readF64();
    zone.heatingSetpoint = reader.readF64();
    zone.coolingSetpoint = reader.readF64();
    zone.heatingCapacity = reader.readF64();
    zone.coolingCapacity = reader.readF64();
    zone.surfaceStart = reader.readI32();
    zone.surfaceCount = reader.readI32();
    zone.scheduleKind = reader.readI32();
    reader.skip(4);
    request.zones.push(zone);
  }

  for (let i = 0; i < surfaceCount; i++) {
    const surface = new Surface();
    surface.area = reader.readF64();
    surface.uValue = reader.readF64();
    surface.tilt = reader.readF64();
    surface.azimuth = reader.readF64();
    surface.shgc = reader.readF64();
    surface.absorptance = reader.readF64();
    surface.kind = reader.readI32();
    surface.boundary = reader.readI32();
    request.surfaces.push(surface);
  }

  return request;
}

/** Lumped capacitance of a zone in J/K. */
function zoneCapacitance(zone: Zone): f64 {
  const air = zone.volume * AIR_DENSITY * AIR_HEAT_CAPACITY;
  const construction = zone.thermalMass * 1000.0;
  // Guard against degenerate zones so the explicit march stays stable.
  const total = air + construction;
  return total > 1000.0 ? total : 1000.0;
}

/** Moves `current` toward `target` by at most `maxStep`. */
// @inline
function approach(current: f64, target: f64, maxStep: f64): f64 {
  const delta = target - current;
  if (delta > maxStep) return current + maxStep;
  if (delta < -maxStep) return current - maxStep;
  return target;
}

export function runSimulation(): i32 {
  const request = readRequest();
  const zones = request.zones;
  const surfaces = request.surfaces;
  const zoneCount = zones.length;

  const perHour = request.timestepsPerHour > 0 ? request.timestepsPerHour : 4;
  const dt: f64 = 3600.0 / <f64>perHour;
  const hours = request.numDays * 24;
  const southern = request.latitude < 0;

  progressStep = 0;
  progressTotal = hours;

  // Hourly series: outdoor dry-bulb, global horizontal solar, then per zone
  // temperature, heating power and cooling power.
  const outdoorSeries = new Float64Array(hours);
  const solarSeries = new Float64Array(hours);
  const tempSeries = new Float64Array(hours * zoneCount);
  const heatSeries = new Float64Array(hours * zoneCount);
  const coolSeries = new Float64Array(hours * zoneCount);

  // Per-zone running totals.
  const heatingJoules = new Float64Array(zoneCount);
  const coolingJoules = new Float64Array(zoneCount);
  const lightingJoules = new Float64Array(zoneCount);
  const equipmentJoules = new Float64Array(zoneCount);
  const peakHeating = new Float64Array(zoneCount);
  const peakCooling = new Float64Array(zoneCount);
  const minTemp = new Float64Array(zoneCount);
  const maxTemp = new Float64Array(zoneCount);
  const unmetHeating = new Float64Array(zoneCount);
  const unmetCooling = new Float64Array(zoneCount);
  const solarJoules = new Float64Array(zoneCount);
  const infiltrationJoules = new Float64Array(zoneCount);
  const envelopeJoules = new Float64Array(zoneCount);
  const latentJoules = new Float64Array(zoneCount);

  // Zone air temperature, seeded at the heating setpoint.
  const temperature = new Float64Array(zoneCount);
  const capacitance = new Float64Array(zoneCount);
  // Setpoints the controller is actually tracking; they chase the scheduled
  // targets at a bounded rate rather than stepping instantly.
  const activeHeatSet = new Float64Array(zoneCount);
  const activeCoolSet = new Float64Array(zoneCount);
  for (let z = 0; z < zoneCount; z++) {
    temperature[z] = zones[z].heatingSetpoint;
    capacitance[z] = zoneCapacitance(zones[z]);
    activeHeatSet[z] = zones[z].heatingSetpoint - SETBACK_DELTA;
    activeCoolSet[z] = zones[z].coolingSetpoint + SETBACK_DELTA;
    minTemp[z] = 1e30;
    maxTemp[z] = -1e30;
  }

  const filmCoefficient = exteriorFilmCoefficient(request.climate.windSpeed);

  for (let h = 0; h < hours; h++) {
    const dayIndex = h / 24;
    const hourOfDay = h % 24;
    const dayOfYear = request.startDay + dayIndex;
    // Jan 1 is treated as a Monday, so day 0 -> index 1.
    const dayOfWeek = (dayOfYear) % 7;

    let hourOutdoor: f64 = 0;
    let hourSolar: f64 = 0;

    for (let z = 0; z < zoneCount; z++) {
      tempSeries[h * zoneCount + z] = 0;
      heatSeries[h * zoneCount + z] = 0;
      coolSeries[h * zoneCount + z] = 0;
    }

    for (let s = 0; s < perHour; s++) {
      const clockHour = <f64>hourOfDay + (<f64>s + 0.5) / <f64>perHour;

      const outdoor = outdoorTemperature(request.climate, dayOfYear, clockHour, southern);
      const sun = sunPosition(
        request.latitude, request.longitude, request.timeZone,
        dayOfYear, clockHour, request.climate.clearness
      );
      const sky = skyTemperature(outdoor, request.climate.clearness);

      hourOutdoor += outdoor;
      hourSolar += sun.globalHorizontal;

      const occupancy = scheduleFraction(zones.length > 0 ? zones[0].scheduleKind : 0, clockHour, dayOfWeek);

      for (let z = 0; z < zoneCount; z++) {
        const zone = zones[z];
        const zoneTemp = temperature[z];
        const fraction = scheduleFraction(zone.scheduleKind, clockHour, dayOfWeek);

        // --- Envelope conduction and transmitted solar ---
        let envelope: f64 = 0;
        let solarGain: f64 = 0;
        const end = zone.surfaceStart + zone.surfaceCount;
        for (let i = zone.surfaceStart; i < end; i++) {
          if (i < 0 || i >= surfaces.length) continue;
          const surface = surfaces[i];
          if (surface.area <= 0 || surface.uValue <= 0) continue;

          if (surface.boundary == BOUNDARY_GROUND) {
            envelope += surface.uValue * surface.area * (request.climate.groundTemp - zoneTemp);
            continue;
          }
          if (surface.boundary != BOUNDARY_OUTDOORS) continue; // adiabatic / interzone

          const incident = incidentOnSurface(sun, surface.tilt, surface.azimuth, GROUND_REFLECTANCE);

          if (surface.kind == SURFACE_WINDOW) {
            envelope += surface.uValue * surface.area * (outdoor - zoneTemp);
            solarGain += surface.shgc * surface.area * incident;
          } else {
            // Sol-air temperature folds absorbed solar and longwave sky loss
            // into an equivalent outdoor temperature.
            let solAir = outdoor + (surface.absorptance * incident) / filmCoefficient;
            if (surface.kind == SURFACE_ROOF) {
              const radiant = STEFAN_BOLTZMANN * 0.9 *
                (Math.pow(outdoor + 273.15, 4.0) - Math.pow(sky + 273.15, 4.0));
              solAir -= radiant / filmCoefficient;
            }
            envelope += surface.uValue * surface.area * (solAir - zoneTemp);
          }
        }

        // --- Internal gains ---
        const lighting = zone.lightingW * fraction;
        const equipment = zone.equipmentW * fraction;
        const peopleSensible = zone.peopleCount * SENSIBLE_PER_PERSON * fraction;
        const peopleLatent = zone.peopleCount * LATENT_PER_PERSON * fraction;
        const internal = lighting + equipment + peopleSensible;

        // --- Infiltration ---
        const massFlow = zone.infiltrationACH * zone.volume / 3600.0 * AIR_DENSITY;
        const infiltration = massFlow * AIR_HEAT_CAPACITY * (outdoor - zoneTemp);

        const freeGain = envelope + solarGain + internal + infiltration;
        const capacity = capacitance[z];

        // --- Ideal-loads control with unoccupied setback ---
        let heatTarget = zone.heatingSetpoint;
        let coolTarget = zone.coolingSetpoint;
        if (fraction < 0.2) {
          heatTarget -= SETBACK_DELTA;
          coolTarget += SETBACK_DELTA;
        }
        // Ramp toward the target so recovery draws a realistic load instead of
        // one enormous spike in the timestep the schedule flips.
        const maxStep = SETPOINT_RAMP_RATE * dt / 3600.0;
        const heatSet = approach(activeHeatSet[z], heatTarget, maxStep);
        const coolSet = approach(activeCoolSet[z], coolTarget, maxStep);
        activeHeatSet[z] = heatSet;
        activeCoolSet[z] = coolSet;

        const freeTemp = zoneTemp + dt * freeGain / capacity;
        let hvac: f64 = 0;

        if (freeTemp < heatSet) {
          hvac = capacity * (heatSet - zoneTemp) / dt - freeGain;
          if (zone.heatingCapacity > 0 && hvac > zone.heatingCapacity) {
            hvac = zone.heatingCapacity;
            unmetHeating[z] += dt / 3600.0;
          }
        } else if (freeTemp > coolSet) {
          hvac = capacity * (coolSet - zoneTemp) / dt - freeGain;
          const limit = zone.coolingCapacity;
          if (limit > 0 && -hvac > limit) {
            hvac = -limit;
            unmetCooling[z] += dt / 3600.0;
          }
        }

        const newTemp = zoneTemp + dt * (freeGain + hvac) / capacity;
        temperature[z] = newTemp;

        const heatingW = hvac > 0 ? hvac : 0;
        const coolingW = hvac < 0 ? -hvac : 0;

        heatingJoules[z] += heatingW * dt;
        coolingJoules[z] += coolingW * dt;
        lightingJoules[z] += lighting * dt;
        equipmentJoules[z] += equipment * dt;
        solarJoules[z] += solarGain * dt;
        infiltrationJoules[z] += infiltration * dt;
        envelopeJoules[z] += envelope * dt;
        latentJoules[z] += peopleLatent * dt;

        if (heatingW > peakHeating[z]) peakHeating[z] = heatingW;
        if (coolingW > peakCooling[z]) peakCooling[z] = coolingW;
        if (newTemp < minTemp[z]) minTemp[z] = newTemp;
        if (newTemp > maxTemp[z]) maxTemp[z] = newTemp;

        const slot = h * zoneCount + z;
        tempSeries[slot] += newTemp;
        heatSeries[slot] += heatingW;
        coolSeries[slot] += coolingW;
      }
    }

    // Collapse the sub-hourly accumulation into hourly means.
    const inv = 1.0 / <f64>perHour;
    outdoorSeries[h] = hourOutdoor * inv;
    solarSeries[h] = hourSolar * inv;
    for (let z = 0; z < zoneCount; z++) {
      const slot = h * zoneCount + z;
      tempSeries[slot] *= inv;
      heatSeries[slot] *= inv;
      coolSeries[slot] *= inv;
    }
    progressStep = h + 1;
  }

  // --- Serialise results ---
  const writer = new ByteWriter(1024 + hours * (2 + zoneCount * 3) * 8 + zoneCount * 128);
  writer.writeI32(zoneCount);
  writer.writeI32(hours);
  writer.writeI32(perHour);
  writer.writeI32(request.numDays);

  for (let h = 0; h < hours; h++) writer.writeF64(outdoorSeries[h]);
  for (let h = 0; h < hours; h++) writer.writeF64(solarSeries[h]);
  for (let z = 0; z < zoneCount; z++) {
    for (let h = 0; h < hours; h++) writer.writeF64(tempSeries[h * zoneCount + z]);
    for (let h = 0; h < hours; h++) writer.writeF64(heatSeries[h * zoneCount + z]);
    for (let h = 0; h < hours; h++) writer.writeF64(coolSeries[h * zoneCount + z]);
  }

  const toKWh: f64 = 1.0 / 3600000.0;
  for (let z = 0; z < zoneCount; z++) {
    writer.writeF64(heatingJoules[z] * toKWh);
    writer.writeF64(coolingJoules[z] * toKWh);
    writer.writeF64(lightingJoules[z] * toKWh);
    writer.writeF64(equipmentJoules[z] * toKWh);
    writer.writeF64(peakHeating[z]);
    writer.writeF64(peakCooling[z]);
    writer.writeF64(minTemp[z] < 1e29 ? minTemp[z] : 0);
    writer.writeF64(maxTemp[z] > -1e29 ? maxTemp[z] : 0);
    writer.writeF64(unmetHeating[z]);
    writer.writeF64(unmetCooling[z]);
    writer.writeF64(solarJoules[z] * toKWh);
    writer.writeF64(infiltrationJoules[z] * toKWh);
    writer.writeF64(envelopeJoules[z] * toKWh);
    writer.writeF64(latentJoules[z] * toKWh);
  }

  writer.finish();
  return hours;
}
