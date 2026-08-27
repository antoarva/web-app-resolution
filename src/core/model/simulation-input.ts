/**
 * Builds the engine's simulation request from the parsed model.
 *
 * This is where IDF's many ways of expressing the same quantity get normalised:
 * lighting can be an absolute wattage, per floor area or per person, and
 * infiltration can be a flow rate or air changes per hour. The engine only ever
 * sees resolved absolute values.
 */

import {
  type IdfModel, objectsOfClass, objectName, numericField, textField, firstOfClass,
} from '@/core/idf/types';
import { type BuildingModel, type ModelSurface } from './building';
import { computeConstruction } from './constructions';
import { nearestLocation, findLocation, type ClimateLocation } from './climate';
import {
  type SimulationInput, type ZoneInput, type SurfaceInput,
  SURFACE_KIND, BOUNDARY, SCHEDULE_KIND,
} from '@/wasm/protocol';

export interface SimulationOptions {
  /** Overrides the location inferred from Site:Location. */
  locationId?: string;
  startDay?: number;
  numDays?: number;
  timestepsPerHour?: number;
  heatingSetpoint?: number;
  coolingSetpoint?: number;
  scheduleKind?: number;
}

/**
 * Share of a construction's mass that exchanges heat with the zone on an hourly
 * cycle. Interior partitions couple on both faces; exterior assemblies have
 * their outer layers largely decoupled by the insulation.
 */
const MASS_PARTICIPATION = { interior: 1.0, exterior: 0.5, ground: 0.35 } as const;

function surfaceKindFor(surface: ModelSurface): number {
  switch (surface.category) {
    case 'roof':
    case 'ceiling':
      return SURFACE_KIND.roof;
    case 'floor':
      return SURFACE_KIND.floor;
    case 'window':
    case 'door':
      return SURFACE_KIND.window;
    default:
      return SURFACE_KIND.wall;
  }
}

function boundaryFor(surface: ModelSurface): number {
  switch (surface.boundary) {
    case 'ground': return BOUNDARY.ground;
    case 'adiabatic': return BOUNDARY.adiabatic;
    case 'surface':
    case 'zone': return BOUNDARY.interzone;
    case 'outdoors': return BOUNDARY.outdoors;
    default: return BOUNDARY.adiabatic;
  }
}

function orientationFor(surface: ModelSurface): 'wall' | 'roof' | 'floor' {
  if (surface.category === 'roof' || surface.category === 'ceiling') return 'roof';
  if (surface.category === 'floor') return 'floor';
  return 'wall';
}

/** Resolves a Lights or ElectricEquipment design level to absolute watts. */
function resolveDesignLevel(
  model: IdfModel,
  className: string,
  zoneName: string,
  floorArea: number,
  peopleCount: number,
): number {
  const target = zoneName.trim().toLowerCase();
  let total = 0;

  for (const object of objectsOfClass(model, className)) {
    if (textField(object, 1, '').trim().toLowerCase() !== target) continue;
    const method = textField(object, 3, 'Watts/Area').toLowerCase();
    if (method === 'lightinglevel' || method === 'equipmentlevel') {
      total += numericField(object, 4, 0);
    } else if (method === 'watts/area') {
      total += numericField(object, 5, 0) * floorArea;
    } else if (method === 'watts/person') {
      total += numericField(object, 6, 0) * peopleCount;
    }
  }
  return total;
}

function resolvePeople(model: IdfModel, zoneName: string, floorArea: number): number {
  const target = zoneName.trim().toLowerCase();
  let total = 0;

  for (const object of objectsOfClass(model, 'People')) {
    if (textField(object, 1, '').trim().toLowerCase() !== target) continue;
    const method = textField(object, 3, 'People').toLowerCase();
    if (method === 'people') {
      total += numericField(object, 4, 0);
    } else if (method === 'people/area') {
      total += numericField(object, 5, 0) * floorArea;
    } else if (method === 'area/person') {
      const perPerson = numericField(object, 6, 0);
      if (perPerson > 0) total += floorArea / perPerson;
    }
  }
  return total;
}

/** Resolves infiltration to air changes per hour, whatever method was used. */
function resolveInfiltration(
  model: IdfModel,
  zoneName: string,
  floorArea: number,
  volume: number,
  exteriorArea: number,
): number {
  const target = zoneName.trim().toLowerCase();
  let flowM3PerSecond = 0;
  let airChanges = 0;

  for (const object of objectsOfClass(model, 'ZoneInfiltration:DesignFlowRate')) {
    if (textField(object, 1, '').trim().toLowerCase() !== target) continue;
    const method = textField(object, 3, 'AirChanges/Hour').toLowerCase();
    if (method === 'flow/zone') {
      flowM3PerSecond += numericField(object, 4, 0);
    } else if (method === 'flow/area') {
      flowM3PerSecond += numericField(object, 5, 0) * floorArea;
    } else if (method === 'flow/exteriorarea' || method === 'flow/exteriorwallarea') {
      flowM3PerSecond += numericField(object, 6, 0) * exteriorArea;
    } else if (method === 'airchanges/hour') {
      airChanges += numericField(object, 7, 0);
    }
  }

  if (volume > 0 && flowM3PerSecond > 0) {
    airChanges += (flowM3PerSecond * 3600) / volume;
  }
  return airChanges;
}

/** Setpoints from the first HVACTemplate:Thermostat, if the file has one. */
function resolveSetpoints(model: IdfModel): { heating: number; cooling: number } {
  const thermostat = firstOfClass(model, 'HVACTemplate:Thermostat');
  if (!thermostat) return { heating: 20, cooling: 24 };
  return {
    heating: numericField(thermostat, 2, 20),
    cooling: numericField(thermostat, 4, 24),
  };
}

/** Capacity limit in watts, or 0 when the file leaves it autosized. */
function resolveCapacityLimit(model: IdfModel, zoneName: string): { heating: number; cooling: number } {
  const target = zoneName.trim().toLowerCase();
  for (const object of objectsOfClass(model, 'HVACTemplate:Zone:IdealLoadsAirSystem')) {
    if (textField(object, 0, '').trim().toLowerCase() !== target) continue;
    const heatingLimit = textField(object, 7, 'NoLimit').toLowerCase();
    const coolingLimit = textField(object, 10, 'NoLimit').toLowerCase();
    return {
      heating: heatingLimit.includes('capacity') ? numericField(object, 9, 0) : 0,
      cooling: coolingLimit.includes('capacity') ? numericField(object, 12, 0) : 0,
    };
  }
  return { heating: 0, cooling: 0 };
}

export function resolveLocation(building: BuildingModel, options: SimulationOptions): ClimateLocation {
  if (options.locationId) {
    const explicit = findLocation(options.locationId);
    if (explicit) return explicit;
  }
  const { latitude, longitude } = building.site;
  // A file with no Site:Location leaves both at zero, which is not a real site.
  if (latitude === 0 && longitude === 0) return nearestLocation(41.98, -87.92);
  return nearestLocation(latitude, longitude);
}

export function buildSimulationInput(
  model: IdfModel,
  building: BuildingModel,
  options: SimulationOptions = {},
): { input: SimulationInput; location: ClimateLocation; zoneNames: string[] } {
  const location = resolveLocation(building, options);
  const setpoints = resolveSetpoints(model);

  const zones: ZoneInput[] = [];
  const surfaces: SurfaceInput[] = [];
  const zoneNames: string[] = [];

  for (const zone of building.zones) {
    const surfaceStart = surfaces.length;
    let thermalMass = 0;

    for (const surface of zone.surfaces) {
      const orientation = orientationFor(surface);
      const boundaryKind = surface.boundary === 'ground'
        ? 'ground'
        : surface.boundary === 'outdoors' ? 'outdoors' : 'interior';

      const construction = computeConstruction(model, surface.constructionName, orientation, boundaryKind);

      // Fallbacks keep a partially authored model simulable.
      const uValue = construction?.uValue ?? (orientation === 'roof' ? 0.3 : 0.5);
      const absorptance = construction?.solarAbsorptance ?? 0.7;

      const participation = surface.boundary === 'outdoors'
        ? MASS_PARTICIPATION.exterior
        : surface.boundary === 'ground' ? MASS_PARTICIPATION.ground : MASS_PARTICIPATION.interior;
      thermalMass += (construction?.heatCapacity ?? 150) * surface.netArea * participation;

      surfaces.push({
        area: surface.netArea,
        uValue,
        tilt: surface.tilt,
        azimuth: surface.azimuth,
        shgc: 0,
        absorptance,
        kind: surfaceKindFor(surface),
        boundary: boundaryFor(surface),
      });

      // Openings are separate surfaces to the solver: they transmit solar.
      for (const window of surface.children) {
        const glazing = computeConstruction(model, window.constructionName, 'wall', 'outdoors');
        surfaces.push({
          area: window.area,
          uValue: glazing?.uValue ?? 2.7,
          tilt: window.tilt,
          azimuth: window.azimuth,
          shgc: glazing?.shgc ?? 0.6,
          absorptance: 0,
          kind: SURFACE_KIND.window,
          boundary: boundaryFor(window),
        });
      }
    }

    const floorArea = zone.floorArea > 0 ? zone.floorArea : 1;
    const peopleCount = resolvePeople(model, zone.name, floorArea);
    const lightingW = resolveDesignLevel(model, 'Lights', zone.name, floorArea, peopleCount);
    const equipmentW = resolveDesignLevel(model, 'ElectricEquipment', zone.name, floorArea, peopleCount);
    const infiltrationACH = resolveInfiltration(
      model, zone.name, floorArea, zone.volume, zone.exteriorWallArea + zone.roofArea,
    );
    const capacity = resolveCapacityLimit(model, zone.name);

    zones.push({
      floorArea,
      volume: zone.volume > 0 ? zone.volume : floorArea * 3,
      thermalMass,
      lightingW,
      equipmentW,
      peopleCount,
      // A sealed model is not physical; hold a minimum leakage rate.
      infiltrationACH: infiltrationACH > 0 ? infiltrationACH : 0.2,
      heatingSetpoint: options.heatingSetpoint ?? setpoints.heating,
      coolingSetpoint: options.coolingSetpoint ?? setpoints.cooling,
      heatingCapacity: capacity.heating,
      coolingCapacity: capacity.cooling,
      surfaceStart,
      surfaceCount: surfaces.length - surfaceStart,
      scheduleKind: options.scheduleKind ?? SCHEDULE_KIND.office,
    });
    zoneNames.push(zone.name);
  }

  const input: SimulationInput = {
    latitude: location.latitude,
    longitude: location.longitude,
    timeZone: location.timeZone,
    elevation: location.elevation,
    startDay: options.startDay ?? 1,
    numDays: options.numDays ?? 365,
    timestepsPerHour: options.timestepsPerHour ?? 4,
    climate: location.climate,
    zones,
    surfaces,
  };

  return { input, location, zoneNames };
}

/** Reasons the model cannot be simulated as it stands. */
export function simulationBlockers(building: BuildingModel): string[] {
  const problems: string[] = [];
  if (building.zones.length === 0) {
    problems.push('The model has no Zone objects.');
  }
  const withSurfaces = building.zones.filter((zone) => zone.surfaces.length > 0);
  if (building.zones.length > 0 && withSurfaces.length === 0) {
    problems.push('No zone has any surfaces, so there is no envelope to solve.');
  }
  const withArea = building.zones.filter((zone) => zone.floorArea > 0);
  if (building.zones.length > 0 && withArea.length === 0) {
    problems.push('No zone has a floor area. Add floor surfaces or set Floor Area on the Zone.');
  }
  return problems;
}

/** Zone names paired with the IDF object ids they came from. */
export function zoneObjectIds(model: IdfModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const zone of objectsOfClass(model, 'Zone')) {
    map.set(objectName(zone).toLowerCase(), zone.id);
  }
  return map;
}
