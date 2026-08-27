/**
 * Thermal properties derived from construction layer stacks.
 *
 * U-values follow the ISO 6946 series method: the layer resistances plus the
 * inside and outside surface films. Glazing is handled separately because a
 * pane's resistance is dominated by the films and cavities, not the glass.
 */

import { type IdfModel, findByName, numericField, textField, objectsOfClass, objectName } from '@/core/idf/types';

/** Surface film resistances, m2K/W (ISO 6946 defaults). */
const FILM_RESISTANCE = {
  insideWall: 0.13,
  insideUp: 0.10,    // heat flow up: ceilings and roofs
  insideDown: 0.17,  // heat flow down: floors
  outside: 0.04,
  ground: 0.0,       // ground contact replaces the outside film
} as const;

export type LayerKind = 'opaque' | 'nomass' | 'airgap' | 'glazing' | 'gas' | 'unknown';

export interface ConstructionLayer {
  name: string;
  kind: LayerKind;
  thickness: number;
  conductivity: number;
  density: number;
  specificHeat: number;
  /** Thermal resistance of this layer alone, m2K/W. */
  resistance: number;
  solarAbsorptance: number;
  solarTransmittance: number;
}

export interface ConstructionProperties {
  name: string;
  layers: ConstructionLayer[];
  /** Whole-assembly U-value including films, W/m2K. */
  uValue: number;
  /** Assembly resistance excluding films, m2K/W. */
  resistance: number;
  /** Areal heat capacity, kJ/m2K — drives the zone's thermal mass. */
  heatCapacity: number;
  thickness: number;
  isWindow: boolean;
  /** Solar heat gain coefficient, windows only. */
  shgc: number;
  /** Exterior solar absorptance, opaque assemblies only. */
  solarAbsorptance: number;
}

function readLayer(model: IdfModel, name: string): ConstructionLayer | null {
  if (!name) return null;

  const opaque = findByName(model, 'Material', name);
  if (opaque) {
    const thickness = numericField(opaque, 2, 0.1);
    const conductivity = numericField(opaque, 3, 1);
    return {
      name,
      kind: 'opaque',
      thickness,
      conductivity,
      density: numericField(opaque, 4, 1000),
      specificHeat: numericField(opaque, 5, 1000),
      resistance: conductivity > 0 ? thickness / conductivity : 0,
      solarAbsorptance: numericField(opaque, 7, 0.7),
      solarTransmittance: 0,
    };
  }

  const noMass = findByName(model, 'Material:NoMass', name);
  if (noMass) {
    return {
      name,
      kind: 'nomass',
      thickness: 0,
      conductivity: 0,
      density: 0,
      specificHeat: 0,
      resistance: numericField(noMass, 2, 0.1),
      solarAbsorptance: numericField(noMass, 4, 0.7),
      solarTransmittance: 0,
    };
  }

  const airGap = findByName(model, 'Material:AirGap', name);
  if (airGap) {
    return {
      name, kind: 'airgap', thickness: 0, conductivity: 0, density: 0, specificHeat: 0,
      resistance: numericField(airGap, 1, 0.16), solarAbsorptance: 0, solarTransmittance: 0,
    };
  }

  const glazing = findByName(model, 'WindowMaterial:Glazing', name);
  if (glazing) {
    const thickness = numericField(glazing, 3, 0.003);
    const conductivity = numericField(glazing, 13, 0.9);
    return {
      name,
      kind: 'glazing',
      thickness,
      conductivity,
      density: 2500,
      specificHeat: 840,
      resistance: conductivity > 0 ? thickness / conductivity : 0,
      solarAbsorptance: 1 - numericField(glazing, 4, 0.775) - numericField(glazing, 5, 0.071),
      solarTransmittance: numericField(glazing, 4, 0.775),
    };
  }

  const gas = findByName(model, 'WindowMaterial:Gas', name);
  if (gas) {
    const thickness = numericField(gas, 2, 0.0127);
    const gasType = textField(gas, 1, 'Air').toLowerCase();
    // Effective cavity conductance, W/m2K, for a sealed vertical unit.
    const conductance = gasType === 'argon' ? 1.9 : gasType === 'krypton' ? 1.5 : 2.6;
    return {
      name, kind: 'gas', thickness, conductivity: 0, density: 1.6, specificHeat: 1000,
      resistance: 1 / conductance, solarAbsorptance: 0, solarTransmittance: 0.99,
    };
  }

  return { name, kind: 'unknown', thickness: 0, conductivity: 0, density: 0, specificHeat: 0,
    resistance: 0.1, solarAbsorptance: 0.7, solarTransmittance: 0 };
}

/**
 * `orientation` selects the inside film, which differs by heat-flow direction.
 */
export function computeConstruction(
  model: IdfModel,
  constructionName: string,
  orientation: 'wall' | 'roof' | 'floor' = 'wall',
  boundary: 'outdoors' | 'ground' | 'interior' = 'outdoors',
): ConstructionProperties | null {
  const construction = findByName(model, 'Construction', constructionName);
  if (!construction) return null;

  // Field 0 is the construction's own Name. Layers start at field 1 with the
  // Outside Layer; reading from 0 adds the construction itself as a phantom
  // layer, which inflates R-value and drags the U-value down with it.
  const layers: ConstructionLayer[] = [];
  for (let i = 1; i < construction.fields.length; i++) {
    const layerName = textField(construction, i, '');
    if (!layerName) continue;
    const layer = readLayer(model, layerName);
    if (layer) layers.push(layer);
  }

  const isWindow = layers.some((layer) => layer.kind === 'glazing' || layer.kind === 'gas');

  let resistance = 0;
  let heatCapacity = 0;
  let thickness = 0;
  for (const layer of layers) {
    resistance += layer.resistance;
    thickness += layer.thickness;
    // kJ/m2K; massless layers contribute nothing.
    heatCapacity += (layer.thickness * layer.density * layer.specificHeat) / 1000;
  }

  const insideFilm =
    orientation === 'roof' ? FILM_RESISTANCE.insideUp
      : orientation === 'floor' ? FILM_RESISTANCE.insideDown
        : FILM_RESISTANCE.insideWall;
  const outsideFilm = boundary === 'ground' ? FILM_RESISTANCE.ground : FILM_RESISTANCE.outside;

  const total = resistance + insideFilm + outsideFilm;
  const uValue = total > 0 ? 1 / total : 0;

  // SHGC approximated as direct transmittance plus the inward-flowing share of
  // what the panes absorb — adequate without full spectral optics.
  let shgc = 0;
  if (isWindow) {
    const panes = layers.filter((layer) => layer.kind === 'glazing');
    let transmittance = 1;
    let absorbed = 0;
    for (const pane of panes) {
      transmittance *= pane.solarTransmittance;
      absorbed += pane.solarAbsorptance;
    }
    shgc = Math.min(0.95, transmittance + absorbed * 0.3);
  }

  const outerLayer = layers[0];
  return {
    name: objectName(construction),
    layers,
    uValue,
    resistance,
    heatCapacity,
    thickness,
    isWindow,
    shgc,
    solarAbsorptance: outerLayer?.solarAbsorptance ?? 0.7,
  };
}

/** Every construction in the model, with properties resolved. */
export function allConstructions(model: IdfModel): ConstructionProperties[] {
  return objectsOfClass(model, 'Construction')
    .map((construction) => computeConstruction(model, objectName(construction)))
    .filter((entry): entry is ConstructionProperties => entry !== null);
}
